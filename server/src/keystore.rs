// Native functions intentionally remain uncalled in the synthetic browser-test build.
#![cfg_attr(feature = "synthetic-tests", allow(dead_code))]
use rand::{RngCore, rngs::OsRng};
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;
pub trait KeyStore: Send + Sync {
    fn create(&self, id: &[u8; 16]) -> Result<Key, String>;
    fn read(&self, id: &[u8; 16]) -> Result<Key, String>;
}
pub fn random_key() -> Key {
    let mut key = Zeroizing::new([0; 32]);
    OsRng.fill_bytes(key.as_mut());
    key
}

pub struct MacKeyStore;
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::ffi::CString;
    unsafe extern "C" {
        fn trilly_key_create(account: *const std::ffi::c_char, key: *const u8) -> i32;
        fn trilly_key_read(account: *const std::ffi::c_char, key: *mut u8) -> i32;
        #[cfg(test)]
        fn trilly_keychain_test(path: *const std::ffi::c_char) -> i32;
    }
    fn account(id: &[u8; 16]) -> CString {
        CString::new(id.iter().map(|b| format!("{b:02x}")).collect::<String>()).unwrap()
    }
    fn check(code: i32) -> Result<(), String> {
        match code {
            0 => Ok(()),
            -128 | -25293 => Err("Unlock cancelled or authentication denied".into()),
            -25300 => Err("This vault's key is missing from your login Keychain. Restore that Keychain from backup.".into()),
            -25308 => Err("macOS needs an interactive login session to unlock Trilly".into()),
            -70001 => Err("The vault key's Keychain access rules changed. Trilly requires password confirmation for every unlock.".into()),
            _ => Err(format!("macOS Keychain could not unlock Trilly (error {code})")),
        }
    }
    impl KeyStore for MacKeyStore {
        fn create(&self, id: &[u8; 16]) -> Result<Key, String> {
            let key = random_key();
            let created = unsafe { trilly_key_create(account(id).as_ptr(), key.as_ptr()) };
            // A cancelled first unlock keeps its random, nonsecret key identifier
            // so retrying can use the already-protected item without orphaning it.
            if created == -25299 {
                return self.read(id);
            }
            check(created)?;
            // Read through the protected ACL, including first setup. No session is
            // issued until the user has approved the native password prompt.
            let verified = self.read(id)?;
            if verified.as_ref() != key.as_ref() {
                return Err("Keychain verification failed".into());
            }
            Ok(verified)
        }
        fn read(&self, id: &[u8; 16]) -> Result<Key, String> {
            let mut key = Zeroizing::new([0; 32]);
            check(unsafe { trilly_key_read(account(id).as_ptr(), key.as_mut_ptr()) })?;
            Ok(key)
        }
    }
    #[cfg(test)]
    #[test]
    fn native_keychain_refuses_silent_reads_even_from_the_creating_process() {
        let dir = tempfile::tempdir().unwrap();
        let path = CString::new(dir.path().join("synthetic.keychain").to_str().unwrap()).unwrap();
        assert_eq!(unsafe { trilly_keychain_test(path.as_ptr()) }, 0);
    }
}
#[cfg(not(target_os = "macos"))]
impl KeyStore for MacKeyStore {
    fn create(&self, _: &[u8; 16]) -> Result<Key, String> {
        Err("Trilly requires macOS".into())
    }
    fn read(&self, _: &[u8; 16]) -> Result<Key, String> {
        Err("Trilly requires macOS".into())
    }
}

// Never shipped in a release binary. Tests must explicitly select this provider
// and supply an isolated data directory; production ignores no authentication.
#[cfg(all(feature = "synthetic-tests", not(debug_assertions)))]
compile_error!("Synthetic authentication cannot be built in release mode");
#[cfg(any(test, feature = "synthetic-tests"))]
pub struct SyntheticKeyStore;
#[cfg(any(test, feature = "synthetic-tests"))]
impl KeyStore for SyntheticKeyStore {
    fn create(&self, id: &[u8; 16]) -> Result<Key, String> {
        self.read(id)
    }
    fn read(&self, id: &[u8; 16]) -> Result<Key, String> {
        let mut key = Zeroizing::new([0; 32]);
        key[..16].copy_from_slice(id);
        key[16..].fill(42);
        Ok(key)
    }
}
