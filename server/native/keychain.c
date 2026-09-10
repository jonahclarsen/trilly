// macOS file-based Keychain supports local executables without provisioning.
// Trust the signed Trilly application across rebuilds; never allow every app.
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <string.h>
#include <libkern/OSByteOrder.h>

#define POLICY_ERROR (-70001)
static const char *SERVICE = "app.trilly.vault";

// Only certificate-signed production builds may establish permanent app trust.
static OSStatus trusted_self(SecTrustedApplicationRef *trusted) {
    SecCodeRef code = NULL;
    CFDictionaryRef info = NULL;
    OSStatus result = SecCodeCopySelf(kSecCSDefaultFlags, &code);
    if (result == errSecSuccess) result = SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL);
    if (result == errSecSuccess) result = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info);
    if (result == errSecSuccess) {
        CFNumberRef flags = CFDictionaryGetValue(info, kSecCodeInfoFlags);
        CFStringRef identifier = CFDictionaryGetValue(info, kSecCodeInfoIdentifier);
        CFArrayRef certificates = CFDictionaryGetValue(info, kSecCodeInfoCertificates);
        uint32_t value = 0;
        if (!flags || !CFNumberGetValue(flags, kCFNumberSInt32Type, &value) ||
            (value & kSecCodeSignatureAdhoc) || !certificates || CFArrayGetCount(certificates) == 0 ||
            !identifier || !CFEqual(identifier, CFSTR("app.trilly"))) result = -70002;
    }
    if (info) CFRelease(info);
    if (code) CFRelease(code);
    if (result != errSecSuccess) return -70002;
    return SecTrustedApplicationCreateFromPath(NULL, trusted);
}

static OSStatus protect_access(SecAccessRef access, SecTrustedApplicationRef trusted) {
    CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
    if (!acls || CFArrayGetCount(acls) == 0) { if (acls) CFRelease(acls); return POLICY_ERROR; }
    CFArrayRef apps = CFArrayCreate(NULL, (const void **)&trusted, 1, &kCFTypeArrayCallBacks);
    OSStatus result = errSecSuccess;
    for (CFIndex i = 0; i < CFArrayGetCount(acls); i++) {
        SecACLRef acl = (SecACLRef)CFArrayGetValueAtIndex(acls, i);
        // Untrusted apps still need native approval; trusted builds read silently.
        result = SecACLSetContents(acl, apps, CFSTR("Trilly vault"), 0);
        if (result != errSecSuccess) break;
    }
    CFRelease(apps); CFRelease(acls);
    return result;
}

static OSStatus verify_access(SecKeychainItemRef item, SecTrustedApplicationRef trusted) {
    SecAccessRef access = NULL;
    OSStatus result = SecKeychainItemCopyAccess(item, &access);
    if (result != errSecSuccess) return result;
    CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
    if (!acls || CFArrayGetCount(acls) == 0) result = POLICY_ERROR;
    for (CFIndex i = 0; result == errSecSuccess && i < CFArrayGetCount(acls); i++) {
        CFArrayRef apps = NULL; CFStringRef description = NULL; CSSM_ACL_KEYCHAIN_PROMPT_SELECTOR selector = {0};
        result = SecACLCopySimpleContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), &apps, &description, &selector);
        if (result == errSecSuccess && (!apps || CFArrayGetCount(apps) != 1 || selector.flags != 0)) result = POLICY_ERROR;
        if (result == errSecSuccess) {
            // CopyData identifies the app path, not its signing requirement.
            // Check policy shape here; securityd enforces the stored requirement
            // when reading the secret, including after the executable changes.
            CFDataRef actual = NULL, expected = NULL;
            result = SecTrustedApplicationCopyData((SecTrustedApplicationRef)CFArrayGetValueAtIndex(apps, 0), &actual);
            if (result == errSecSuccess) result = SecTrustedApplicationCopyData(trusted, &expected);
            if (result == errSecSuccess && !CFEqual(actual, expected)) result = POLICY_ERROR;
            if (actual) CFRelease(actual);
            if (expected) CFRelease(expected);
        }
        if (apps) CFRelease(apps);
        if (description) CFRelease(description);
    }
    if (acls) CFRelease(acls);
    CFRelease(access);
    return result;
}

// Repair only the access rules of this exact item, before requesting its key.
// SetAccess uses macOS authorization and may show a separate native prompt.
// Never ignore a failed migration or replace the encryption key. Owner ACLs
// are preserved; only the decrypt permission is migrated.
typedef OSStatus (*AccessSetter)(SecKeychainItemRef, SecAccessRef);
static OSStatus ensure_access(SecKeychainItemRef item, SecTrustedApplicationRef trusted, AccessSetter set_access) {
    OSStatus result = verify_access(item, trusted);
    if (result != POLICY_ERROR) return result;
    SecAccessRef access = NULL;
    result = SecKeychainItemCopyAccess(item, &access);
    if (result != errSecSuccess) return result;
    result = protect_access(access, trusted);
    if (result == errSecSuccess) result = set_access(item, access);
    CFRelease(access);
    if (result == errSecSuccess) result = verify_access(item, trusted);
    return result;
}

static OSStatus create_key(SecKeychainRef keychain, const char *account, const unsigned char *key, SecKeychainItemRef *created, SecTrustedApplicationRef trusted) {
    CFArrayRef apps = CFArrayCreate(NULL, (const void **)&trusted, 1, &kCFTypeArrayCallBacks);
    SecAccessRef access = NULL;
    OSStatus result = SecAccessCreate(CFSTR("Trilly vault"), apps, &access);
    CFRelease(apps);
    if (result != errSecSuccess) return result;
    result = protect_access(access, trusted);
    if (result == errSecSuccess) {
        char label[] = "Trilly vault";
        SecKeychainAttribute attributes[] = {
            { kSecServiceItemAttr, (UInt32)strlen(SERVICE), (void *)SERVICE },
            { kSecAccountItemAttr, (UInt32)strlen(account), (void *)account },
            { kSecLabelItemAttr, (UInt32)strlen(label), label }
        };
        SecKeychainAttributeList list = { 3, attributes };
        // ACLs are attached at creation. No interval with an unprotected item.
        result = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list, 32, key, keychain, access, created);
    }
    CFRelease(access);
    return result;
}

static OSStatus read_key_with_setter(SecKeychainRef keychain, const char *account, unsigned char *key, SecTrustedApplicationRef trusted, AccessSetter set_access) {
    SecKeychainItemRef item = NULL;
    // Locate the exact item without requesting its secret.
    OSStatus result = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(SERVICE), SERVICE,
        (UInt32)strlen(account), account, NULL, NULL, &item);
    if (result != errSecSuccess) return result;
    result = ensure_access(item, trusted, set_access);
    UInt32 length = 0; void *bytes = NULL;
    if (result == errSecSuccess) result = SecKeychainItemCopyContent(item, NULL, NULL, &length, &bytes);
    if (result == errSecSuccess) {
        if (length != 32) result = errSecDecode;
        else memcpy(key, bytes, 32);
    }
    if (bytes) {
        // Security.framework owns this buffer, but it is writable until freed.
        volatile unsigned char *wipe = bytes;
        for (UInt32 i = 0; i < length; i++) wipe[i] = 0;
        SecKeychainItemFreeContent(NULL, bytes);
    }
    CFRelease(item);
    return result;
}

static OSStatus read_key(SecKeychainRef keychain, const char *account, unsigned char *key, SecTrustedApplicationRef trusted) {
    return read_key_with_setter(keychain, account, key, trusted, SecKeychainItemSetAccess);
}

// An authorization denial is injected; never open a real denial-test prompt.
static OSStatus denied_access(SecKeychainItemRef item, SecAccessRef access) {
    (void)item; (void)access;
    return errSecAuthFailed;
}

int trilly_key_create(const char *account, const unsigned char *key) {
    SecTrustedApplicationRef trusted = NULL;
    OSStatus result = trusted_self(&trusted);
    if (result != errSecSuccess) return result;
    SecKeychainRef keychain = NULL;
    result = SecKeychainCopyDefault(&keychain);
    SecKeychainItemRef item = NULL;
    if (result == errSecSuccess) result = create_key(keychain, account, key, &item, trusted);
    if (result == errSecSuccess) result = verify_access(item, trusted);
    if (item) CFRelease(item);
    if (keychain) CFRelease(keychain);
    CFRelease(trusted);
    return result;
}

int trilly_key_read(const char *account, unsigned char *key) {
    SecTrustedApplicationRef trusted = NULL;
    OSStatus result = trusted_self(&trusted);
    if (result != errSecSuccess) return result;
    SecKeychainRef keychain = NULL;
    result = SecKeychainCopyDefault(&keychain);
    if (result == errSecSuccess) result = read_key(keychain, account, key, trusted);
    if (keychain) CFRelease(keychain);
    CFRelease(trusted);
    return result;
}

// Uses only a new, isolated test Keychain, never the user's default Keychain.
// UI is disabled. Fixture-owner ACLs alone permit automated migration edits.
int trilly_keychain_test(const char *path, int scenario) {
    if (scenario < 0 || scenario > 4) return errSecParam;
    Boolean allowed = true;
    SecKeychainGetUserInteractionAllowed(&allowed);
    SecKeychainSetUserInteractionAllowed(false);
    SecTrustedApplicationRef trusted = NULL;
    OSStatus trusted_result = SecTrustedApplicationCreateFromPath(NULL, &trusted);
    if (trusted_result != errSecSuccess) { SecKeychainSetUserInteractionAllowed(allowed); return trusted_result; }
    SecKeychainRef keychain = NULL;
    const char *password = "synthetic-keychain-test-only";
    OSStatus result = SecKeychainCreate(path, (UInt32)strlen(password), password, false, NULL, &keychain);
    unsigned char key[32] = { 17 }; unsigned char output[32] = { 0 };
    SecKeychainItemRef item = NULL;
    if (result == errSecSuccess && scenario == 0) result = create_key(keychain, "synthetic-test-key", key, &item, trusted);
    if (result == errSecSuccess && scenario != 0) {
        // Intentionally changed rules on a NEW synthetic item only. Permit ACL
        // edits on this fixture so repair can be tested with all UI disabled.
        SecAccessRef access = NULL;
        result = SecAccessCreate(CFSTR("Synthetic test key"), NULL, &access);
        CFArrayRef owners = result == errSecSuccess ? SecAccessCopyMatchingACLList(access, kSecACLAuthorizationChangeACL) : NULL;
        // SetAccess can prompt despite interaction=false. This test must never
        // reach it unless the NEW fixture explicitly permits owner ACL edits.
        if (result == errSecSuccess && (!owners || CFArrayGetCount(owners) == 0)) result = POLICY_ERROR;
        for (CFIndex i = 0; result == errSecSuccess && owners && i < CFArrayGetCount(owners); i++) {
            result = SecACLSetContents((SecACLRef)CFArrayGetValueAtIndex(owners, i), NULL, CFSTR("Synthetic test owner"), 0);
        }
        if (owners) CFRelease(owners);
        if (result == errSecSuccess) {
            CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
            CFArrayRef nobody = CFArrayCreate(NULL, NULL, 0, &kCFTypeArrayCallBacks);
            for (CFIndex i = 0; result == errSecSuccess && acls && i < CFArrayGetCount(acls); i++) {
                // 2: prompt lacks password requirement. 3: allow any process.
                result = SecACLSetContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), scenario == 3 ? NULL : nobody, CFSTR("Synthetic test key"), scenario == 1 ? kSecKeychainPromptRequirePassphase | OSSwapInt16(kSecKeychainPromptRequirePassphase) : 0);
            }
            CFRelease(nobody);
            if (acls) CFRelease(acls);
        }
        if (result == errSecSuccess) {
            char account[] = "synthetic-test-key";
            SecKeychainAttribute attributes[] = {
                { kSecServiceItemAttr, (UInt32)strlen(SERVICE), (void *)SERVICE },
                { kSecAccountItemAttr, (UInt32)strlen(account), account }
            };
            SecKeychainAttributeList list = { 2, attributes };
            result = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list, 32, key, keychain, access, &item);
        }
        if (access) CFRelease(access);
        if (result == errSecSuccess && verify_access(item, trusted) != POLICY_ERROR) result = errSecDecode;
    }
    if (result == errSecSuccess && scenario == 4) {
        OSStatus denied = read_key_with_setter(keychain, "synthetic-test-key", output, trusted, denied_access);
        if (denied != errSecAuthFailed) result = POLICY_ERROR;
        for (size_t i = 0; i < sizeof(output); i++) if (output[i] != 0) result = POLICY_ERROR;
        if (result == errSecSuccess && verify_access(item, trusted) != POLICY_ERROR) result = POLICY_ERROR;
    }
    if (result == errSecSuccess && scenario == 0) result = verify_access(item, trusted);
    if (result == errSecSuccess) {
        OSStatus read = read_key(keychain, "synthetic-test-key", output, trusted);
        result = read;
    }
    if (result == errSecSuccess) result = verify_access(item, trusted);
    if (result == errSecSuccess) {
        result = SecKeychainLock(keychain);
        if (result == errSecSuccess) result = SecKeychainUnlock(keychain, (UInt32)strlen(password), password, true);
        if (result == errSecSuccess) result = verify_access(item, trusted);
        if (result == errSecSuccess) {
            OSStatus read = read_key(keychain, "synthetic-test-key", output, trusted);
            result = read;
        }
    }
    // Migration preserves the existing key; subsequent reads need no UI.
    if (result == errSecSuccess && memcmp(output, key, sizeof(key)) != 0) result = POLICY_ERROR;
    if (item) CFRelease(item);
    if (keychain) {
        OSStatus cleanup = SecKeychainDelete(keychain);
        if (result == errSecSuccess) result = cleanup;
        CFRelease(keychain);
    }
    CFRelease(trusted);
    SecKeychainSetUserInteractionAllowed(allowed);
    memset(key, 0, sizeof(key)); memset(output, 0, sizeof(output));
    return result;
}
