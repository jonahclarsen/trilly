// macOS file-based Keychain supports local executables without provisioning.
// The Keychain enforces password entry; an app-level boolean is not sufficient.
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <string.h>
#include <libkern/OSByteOrder.h>

#define POLICY_ERROR (-70001)
static const char *SERVICE = "app.trilly.vault";

static OSStatus protect_access(SecAccessRef access) {
    CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
    if (!acls || CFArrayGetCount(acls) == 0) { if (acls) CFRelease(acls); return POLICY_ERROR; }
    CFArrayRef nobody = CFArrayCreate(NULL, NULL, 0, &kCFTypeArrayCallBacks);
    OSStatus result = errSecSuccess;
    for (CFIndex i = 0; i < CFArrayGetCount(acls); i++) {
        SecACLRef acl = (SecACLRef)CFArrayGetValueAtIndex(acls, i);
        // Apple's legacy KeychainPromptAclSubject::exportBlob mutates selector
        // flags into network byte order. Preserve REQUIRE_PASSPHRASE across
        // that round trip; bit 8 is otherwise unused by the prompt selector.
        // https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/acl_keychain.cpp
        result = SecACLSetContents(acl, nobody, CFSTR("Trilly vault"),
            kSecKeychainPromptRequirePassphase | OSSwapInt16(kSecKeychainPromptRequirePassphase));
        if (result != errSecSuccess) break;
    }
    CFRelease(nobody); CFRelease(acls);
    return result;
}

static OSStatus verify_access(SecKeychainItemRef item) {
    SecAccessRef access = NULL;
    OSStatus result = SecKeychainItemCopyAccess(item, &access);
    if (result != errSecSuccess) return result;
    CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
    if (!acls || CFArrayGetCount(acls) == 0) result = POLICY_ERROR;
    for (CFIndex i = 0; result == errSecSuccess && i < CFArrayGetCount(acls); i++) {
        CFArrayRef apps = NULL; CFStringRef description = NULL; CSSM_ACL_KEYCHAIN_PROMPT_SELECTOR selector = {0};
        result = SecACLCopySimpleContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), &apps, &description, &selector);
        if (result == errSecSuccess && (!apps || CFArrayGetCount(apps) != 0 || !(selector.flags & kSecKeychainPromptRequirePassphase))) result = POLICY_ERROR;
        if (apps) CFRelease(apps);
        if (description) CFRelease(description);
    }
    if (acls) CFRelease(acls);
    CFRelease(access);
    return result;
}

// Repair only the access rules of this exact item, before requesting its key.
// SetAccess uses macOS authorization and may show a separate native prompt.
// Never ignore a failed repair, replace the key, or fall back to a silent read.
static OSStatus ensure_access(SecKeychainItemRef item) {
    OSStatus result = verify_access(item);
    if (result != POLICY_ERROR) return result;
    SecAccessRef access = NULL;
    result = SecKeychainItemCopyAccess(item, &access);
    if (result != errSecSuccess) return result;
    result = protect_access(access);
    if (result == errSecSuccess) result = SecKeychainItemSetAccess(item, access);
    CFRelease(access);
    if (result == errSecSuccess) result = verify_access(item);
    return result;
}

static OSStatus create_key(SecKeychainRef keychain, const char *account, const unsigned char *key, SecKeychainItemRef *created) {
    CFArrayRef nobody = CFArrayCreate(NULL, NULL, 0, &kCFTypeArrayCallBacks);
    SecAccessRef access = NULL;
    OSStatus result = SecAccessCreate(CFSTR("Trilly vault"), nobody, &access);
    CFRelease(nobody);
    if (result != errSecSuccess) return result;
    result = protect_access(access);
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

static OSStatus read_key(SecKeychainRef keychain, const char *account, unsigned char *key) {
    SecKeychainItemRef item = NULL;
    // Locate the exact item without requesting its secret.
    OSStatus result = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(SERVICE), SERVICE,
        (UInt32)strlen(account), account, NULL, NULL, &item);
    if (result != errSecSuccess) return result;
    result = ensure_access(item);
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

int trilly_key_create(const char *account, const unsigned char *key) {
    SecKeychainRef keychain = NULL;
    OSStatus result = SecKeychainCopyDefault(&keychain);
    if (result != errSecSuccess) return result;
    SecKeychainItemRef item = NULL;
    result = create_key(keychain, account, key, &item);
    if (result == errSecSuccess) result = verify_access(item);
    if (item) CFRelease(item);
    CFRelease(keychain);
    return result;
}

int trilly_key_read(const char *account, unsigned char *key) {
    SecKeychainRef keychain = NULL;
    OSStatus result = SecKeychainCopyDefault(&keychain);
    if (result == errSecSuccess) result = read_key(keychain, account, key);
    if (keychain) CFRelease(keychain);
    return result;
}

// Uses only a new, isolated test Keychain, never the user's default Keychain.
// UI is disabled: successful secret retrieval would be a security failure.
int trilly_keychain_test(const char *path, int scenario) {
    if (scenario < 0 || scenario > 3) return errSecParam;
    Boolean allowed = true;
    SecKeychainGetUserInteractionAllowed(&allowed);
    SecKeychainSetUserInteractionAllowed(false);
    SecKeychainRef keychain = NULL;
    const char *password = "synthetic-keychain-test-only";
    OSStatus result = SecKeychainCreate(path, (UInt32)strlen(password), password, false, NULL, &keychain);
    unsigned char key[32] = { 17 }; unsigned char output[32] = { 0 };
    SecKeychainItemRef item = NULL;
    if (result == errSecSuccess && scenario == 0) result = create_key(keychain, "synthetic-test-key", key, &item);
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
        if (result == errSecSuccess && scenario != 1) {
            CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
            CFArrayRef nobody = CFArrayCreate(NULL, NULL, 0, &kCFTypeArrayCallBacks);
            for (CFIndex i = 0; result == errSecSuccess && acls && i < CFArrayGetCount(acls); i++) {
                // 2: prompt lacks password requirement. 3: allow any process.
                result = SecACLSetContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), scenario == 2 ? nobody : NULL, CFSTR("Synthetic test key"), 0);
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
        if (result == errSecSuccess && verify_access(item) != POLICY_ERROR) result = errSecDecode;
    }
    if (result == errSecSuccess && scenario == 0) result = verify_access(item);
    if (result == errSecSuccess) {
        OSStatus read = read_key(keychain, "synthetic-test-key", output);
        result = (read == errSecInteractionNotAllowed || read == errSecAuthFailed) ? errSecSuccess : (read == errSecSuccess ? POLICY_ERROR : read);
    }
    if (result == errSecSuccess) result = verify_access(item);
    if (result == errSecSuccess) {
        result = SecKeychainLock(keychain);
        if (result == errSecSuccess) result = SecKeychainUnlock(keychain, (UInt32)strlen(password), password, true);
        if (result == errSecSuccess) result = verify_access(item);
        if (result == errSecSuccess) {
            OSStatus read = read_key(keychain, "synthetic-test-key", output);
            result = (read == errSecInteractionNotAllowed || read == errSecAuthFailed) ? errSecSuccess : POLICY_ERROR;
        }
    }
    // A failed/unavailable native prompt must never return even part of a key.
    for (size_t i = 0; i < sizeof(output); i++) if (output[i] != 0) result = POLICY_ERROR;
    if (item) CFRelease(item);
    if (keychain) {
        OSStatus cleanup = SecKeychainDelete(keychain);
        if (result == errSecSuccess) result = cleanup;
        CFRelease(keychain);
    }
    SecKeychainSetUserInteractionAllowed(allowed);
    memset(key, 0, sizeof(key)); memset(output, 0, sizeof(output));
    return result;
}
