// Standalone signed fixture: never calls trilly_key_create/read, accesses the
// default Keychain, or displays native authorization UI.
#include "../server/native/keychain.c"
#include <stdio.h>
#ifndef FIXTURE_VERSION
#define FIXTURE_VERSION 1
#endif

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    SecKeychainSetUserInteractionAllowed(false);
    const char *password = "synthetic-signing-fixture-only";
    const char *account = "synthetic-signing-key";
    unsigned char key[32] = { 73 }, output[32] = { 0 };
    SecKeychainRef keychain = NULL;
    SecKeychainItemRef item = NULL;
    SecTrustedApplicationRef trusted = NULL;
    OSStatus result;
    if (strcmp(argv[1], "create-legacy") == 0) {
        result = SecKeychainCreate(argv[2], (UInt32)strlen(password), password, false, NULL, &keychain);
        SecAccessRef access = NULL;
        CFArrayRef nobody = CFArrayCreate(NULL, NULL, 0, &kCFTypeArrayCallBacks);
        if (result == errSecSuccess) result = SecAccessCreate(CFSTR("Synthetic legacy key"), nobody, &access);
        CFArrayRef owners = result == errSecSuccess ? SecAccessCopyMatchingACLList(access, kSecACLAuthorizationChangeACL) : NULL;
        if (result == errSecSuccess && (!owners || CFArrayGetCount(owners) == 0)) result = POLICY_ERROR;
        for (CFIndex i = 0; result == errSecSuccess && i < CFArrayGetCount(owners); i++) {
            // New fixture only: editable owner avoids any real repair prompt.
            result = SecACLSetContents((SecACLRef)CFArrayGetValueAtIndex(owners, i), NULL, CFSTR("Synthetic editable owner"), 0);
        }
        if (owners) CFRelease(owners);
        CFArrayRef decrypt = result == errSecSuccess ? SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt) : NULL;
        if (result == errSecSuccess && (!decrypt || CFArrayGetCount(decrypt) == 0)) result = POLICY_ERROR;
        for (CFIndex i = 0; result == errSecSuccess && i < CFArrayGetCount(decrypt); i++) {
            result = SecACLSetContents((SecACLRef)CFArrayGetValueAtIndex(decrypt, i), nobody, CFSTR("Synthetic legacy key"),
                kSecKeychainPromptRequirePassphase | OSSwapInt16(kSecKeychainPromptRequirePassphase));
        }
        if (decrypt) CFRelease(decrypt);
        CFRelease(nobody);
        SecKeychainAttribute attributes[] = {
            { kSecServiceItemAttr, (UInt32)strlen(SERVICE), (void *)SERVICE },
            { kSecAccountItemAttr, (UInt32)strlen(account), (void *)account }
        };
        SecKeychainAttributeList list = { 2, attributes };
        if (result == errSecSuccess) result = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list, 32, key, keychain, access, &item);
        if (access) CFRelease(access);
        memcpy(output, key, sizeof(key)); // creation only; legacy access cannot read silently
    } else if (strcmp(argv[1], "create") == 0) {
        result = trusted_self(&trusted);
        if (result == errSecSuccess) result = SecKeychainCreate(argv[2], (UInt32)strlen(password), password, false, NULL, &keychain);
        if (result == errSecSuccess) result = create_key(keychain, account, key, &item, trusted);
        if (result == errSecSuccess) result = read_key(keychain, account, output, trusted);
    } else {
        result = SecKeychainOpen(argv[2], &keychain);
        if (result == errSecSuccess) result = SecKeychainUnlock(keychain, (UInt32)strlen(password), password, true);
        if (result == errSecSuccess && strcmp(argv[1], "read") == 0) {
            result = trusted_self(&trusted);
            if (result == errSecSuccess) result = read_key(keychain, account, output, trusted);
        } else if (result == errSecSuccess && strcmp(argv[1], "deny") == 0) {
            // Direct native read proves securityd enforces identity even when
            // the caller bypasses all of Trilly's application-level checks.
            UInt32 length = 0; void *bytes = NULL;
            OSStatus read = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(SERVICE), SERVICE,
                (UInt32)strlen(account), account, &length, &bytes, NULL);
            result = ((read == errSecInteractionNotAllowed || read == errSecAuthFailed) && bytes == NULL) ? errSecSuccess : POLICY_ERROR;
            if (bytes) { memset(bytes, 0, length); SecKeychainItemFreeContent(NULL, bytes); }
            memcpy(output, key, sizeof(key)); // expected fixture result, never retrieved
        } else if (result == errSecSuccess && strcmp(argv[1], "delete") == 0) {
            result = SecKeychainDelete(keychain);
            memcpy(output, key, sizeof(key));
        } else if (result == errSecSuccess) result = errSecParam;
    }
    if (result == errSecSuccess && memcmp(key, output, sizeof(key)) != 0) result = POLICY_ERROR;
    if (trusted) CFRelease(trusted);
    if (item) CFRelease(item);
    if (keychain) CFRelease(keychain);
    printf("Synthetic signed fixture v%d %s: %d\n", FIXTURE_VERSION, argv[1], (int)result);
    return result == errSecSuccess ? 0 : 1;
}
