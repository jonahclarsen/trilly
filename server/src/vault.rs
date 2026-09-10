use crate::{keystore::KeyStore, model::Data};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rand::{RngCore, rngs::OsRng};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

// Version fixes the KDF parameters and payload layout. Never silently change them.
// Legacy marker remains only for migration; never rename existing file formats.
const LEGACY_MAGIC: &[u8; 8] = b"YNPLUS01";
const MAGIC: &[u8; 8] = b"TRILLY02";
const HEADER: usize = 8 + 16 + 24;

pub struct Vault {
    pub path: PathBuf,
    id: [u8; 16],
    legacy: bool,
    key: Zeroizing<[u8; 32]>,
    pub data: Data,
}

fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut key = Zeroizing::new([0; 32]);
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| "Key derivation failed")?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "Key derivation failed")?;
    Ok(key)
}

impl Vault {
    #[cfg(test)]
    pub fn create(path: PathBuf, password: &str) -> Result<Self, String> {
        if path.exists() {
            return Err("A vault already exists".into());
        }
        if password.chars().count() < 14 {
            return Err("Use at least 14 characters".into());
        }
        let mut salt = [0; 16];
        OsRng.fill_bytes(&mut salt);
        let vault = Self {
            path,
            id: salt,
            legacy: true,
            key: derive(password, &salt)?,
            data: Data::default(),
        };
        vault.save(&vault.data)?;
        Ok(vault)
    }

    pub fn unlock_legacy(path: PathBuf, password: &str) -> Result<Self, String> {
        let bytes = fs::read(&path).map_err(|_| "Could not read vault")?;
        if bytes.len() < HEADER + 16 || &bytes[..8] != LEGACY_MAGIC {
            return Err("Invalid vault format".into());
        }
        let salt: [u8; 16] = bytes[8..24].try_into().unwrap();
        let key = derive(password, &salt)?;
        let cipher = XChaCha20Poly1305::new(key.as_ref().into());
        let plain = Zeroizing::new(
            cipher
                .decrypt(
                    XNonce::from_slice(&bytes[24..HEADER]),
                    Payload {
                        msg: &bytes[HEADER..],
                        aad: &bytes[..24],
                    },
                )
                .map_err(|_| "Incorrect passphrase or damaged vault")?,
        );
        let data = serde_json::from_slice(&plain).map_err(|_| "Invalid vault contents")?;
        Ok(Self {
            path,
            id: salt,
            legacy: true,
            key,
            data,
        })
    }

    pub fn is_legacy(path: &Path) -> Result<bool, String> {
        let mut header = [0; 8];
        fs::File::open(path)
            .and_then(|mut f| f.read_exact(&mut header))
            .map_err(|_| "Could not read vault header")?;
        if &header == LEGACY_MAGIC {
            Ok(true)
        } else if &header == MAGIC {
            Ok(false)
        } else {
            Err("Invalid vault format".into())
        }
    }

    pub fn open_native(path: PathBuf, keys: &dyn KeyStore) -> Result<Self, String> {
        let bytes = fs::read(&path).map_err(|_| "Could not read vault")?;
        if bytes.len() < HEADER + 16 || &bytes[..8] != MAGIC {
            return Err("Vault requires migration".into());
        }
        let id: [u8; 16] = bytes[8..24].try_into().unwrap();
        let key = keys.read(&id)?;
        let plain = Zeroizing::new(
            XChaCha20Poly1305::new(key.as_ref().into())
                .decrypt(
                    XNonce::from_slice(&bytes[24..HEADER]),
                    Payload {
                        msg: &bytes[HEADER..],
                        aad: &bytes[..24],
                    },
                )
                .map_err(|_| "Vault key does not match or the vault is damaged")?,
        );
        let data = serde_json::from_slice(&plain).map_err(|_| "Invalid vault contents")?;
        Ok(Self {
            path,
            id,
            key,
            legacy: false,
            data,
        })
    }

    pub fn create_native(path: PathBuf, keys: &dyn KeyStore) -> Result<Self, String> {
        if path.exists() {
            return Err("A vault already exists".into());
        }
        Self::write_native(path, Data::default(), keys)
    }

    pub fn migrate(
        source: PathBuf,
        destination: PathBuf,
        password: &str,
        keys: &dyn KeyStore,
    ) -> Result<Self, String> {
        if source != destination && destination.exists() {
            return Err("The destination vault already exists".into());
        }
        let old = Self::unlock_legacy(source, password)?;
        // The original file is replaced only after both passphrase verification and
        // native authorization have succeeded. Migration across directories leaves
        // the old encrypted file intact as a backup.
        Self::write_native(destination, old.data.clone(), keys)
    }

    fn write_native(path: PathBuf, data: Data, keys: &dyn KeyStore) -> Result<Self, String> {
        let pending = path.with_extension("key-id");
        let id: [u8; 16] = if pending.exists() {
            fs::read(&pending)
                .map_err(|_| "Could not read pending key identifier")?
                .try_into()
                .map_err(|_| "Invalid pending key identifier")?
        } else {
            let mut id = [0; 16];
            OsRng.fill_bytes(&mut id);
            atomic_write(&pending, &id)?;
            id
        };
        let key = keys.create(&id)?;
        let vault = Self {
            path,
            id,
            key,
            legacy: false,
            data,
        };
        vault.save(&vault.data)?;
        let _ = fs::remove_file(pending);
        Ok(vault)
    }

    pub fn save(&self, data: &Data) -> Result<(), String> {
        let plain = Zeroizing::new(serde_json::to_vec(data).map_err(|_| "Could not encode vault")?);
        let cipher = XChaCha20Poly1305::new(self.key.as_ref().into());
        let mut nonce = [0; 24];
        OsRng.fill_bytes(&mut nonce);
        let mut bytes = Vec::from(if self.legacy {
            LEGACY_MAGIC.as_slice()
        } else {
            MAGIC.as_slice()
        });
        bytes.extend_from_slice(&self.id);
        let encrypted = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plain,
                    aad: &bytes,
                },
            )
            .map_err(|_| "Could not encrypt vault")?;
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&encrypted);
        atomic_write(&self.path, &bytes)
    }

    pub fn commit(&mut self, next: Data) -> Result<(), String> {
        self.save(&next)?;
        self.data = next;
        Ok(())
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("vault.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    // Do not follow an existing temporary symlink, including on non-macOS Unix.
    if fs::symlink_metadata(&tmp).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Invalid temporary vault file".into());
    }
    let mut file = options.open(&tmp).map_err(|_| "Could not write vault")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not save vault")?;
    fs::rename(&tmp, path).map_err(|_| "Could not replace vault")?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| "Could not sync vault directory")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::{Key, SyntheticKeyStore};

    struct Denied;
    impl KeyStore for Denied {
        fn create(&self, _: &[u8; 16]) -> Result<Key, String> {
            Err("Synthetic native cancellation".into())
        }
        fn read(&self, _: &[u8; 16]) -> Result<Key, String> {
            Err("Synthetic native cancellation".into())
        }
    }
    #[test]
    fn native_roundtrip_requires_the_key_and_detects_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native.vault");
        let mut v = Vault::create_native(path.clone(), &SyntheticKeyStore).unwrap();
        let mut data = Data::default();
        data.token = "SYNTHETIC_PRIVATE_TOKEN".into();
        v.commit(data).unwrap();
        drop(v);
        assert!(!Vault::is_legacy(&path).unwrap());
        let encrypted = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&encrypted).contains("SYNTHETIC_PRIVATE_TOKEN"));
        assert!(Vault::open_native(path.clone(), &Denied).is_err());
        assert_eq!(
            Vault::open_native(path.clone(), &SyntheticKeyStore)
                .unwrap()
                .data
                .token,
            "SYNTHETIC_PRIVATE_TOKEN"
        );
        let mut altered = encrypted;
        *altered.last_mut().unwrap() ^= 1;
        fs::write(&path, altered).unwrap();
        assert!(Vault::open_native(path, &SyntheticKeyStore).is_err());
    }
    #[test]
    fn migration_preserves_history_outbox_and_original_on_cancellation_or_wrong_password() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.vault");
        let mut old = Vault::create(path.clone(), "synthetic old passphrase").unwrap();
        let mut data = Data::default();
        data.token = "synthetic-token".into();
        data.transactions.push(crate::model::Transaction {
            id: "synthetic-history".into(),
            amount: -43210,
            ..Default::default()
        });
        data.pending.push(crate::model::Pending {
            before: data.transactions[0].clone(),
            change: crate::model::Change::from(&data.transactions[0]),
            conflict: false,
        });
        old.commit(data).unwrap();
        drop(old);
        let before = fs::read(&path).unwrap();
        assert!(Vault::migrate(path.clone(), path.clone(), "wrong", &SyntheticKeyStore).is_err());
        assert_eq!(before, fs::read(&path).unwrap());
        assert!(
            Vault::migrate(
                path.clone(),
                path.clone(),
                "synthetic old passphrase",
                &Denied
            )
            .is_err()
        );
        assert_eq!(before, fs::read(&path).unwrap());
        let id = fs::read(path.with_extension("key-id")).unwrap();
        let v = Vault::migrate(
            path.clone(),
            path.clone(),
            "synthetic old passphrase",
            &SyntheticKeyStore,
        )
        .unwrap();
        assert_eq!(v.data.token, "synthetic-token");
        assert_eq!(v.data.pending.len(), 1);
        assert_eq!(v.data.transactions[0].amount, -43210);
        assert_eq!(v.id.as_slice(), id);
        drop(v);
        assert!(!Vault::is_legacy(&path).unwrap());
        assert!(Vault::unlock_legacy(path.clone(), "synthetic old passphrase").is_err());
        assert_eq!(
            Vault::open_native(path, &SyntheticKeyStore)
                .unwrap()
                .data
                .pending
                .len(),
            1
        );
    }
    #[test]
    fn migration_to_new_directory_leaves_old_encrypted_backup_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("old.vault");
        let dest = dir.path().join("new.vault");
        Vault::create(source.clone(), "synthetic old passphrase").unwrap();
        let old = fs::read(&source).unwrap();
        Vault::migrate(
            source.clone(),
            dest.clone(),
            "synthetic old passphrase",
            &SyntheticKeyStore,
        )
        .unwrap();
        assert_eq!(old, fs::read(source).unwrap());
        assert!(Vault::open_native(dest, &SyntheticKeyStore).is_ok());
    }
    #[test]
    fn encrypted_roundtrip_wrong_password_and_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.vault");
        let mut vault = Vault::create(path.clone(), "synthetic password only").unwrap();
        let mut data = Data::default();
        data.token = "SYNTHETIC-TOKEN-MUST-NOT-BE-PLAINTEXT".into();
        vault.commit(data).unwrap();
        let first = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&first).contains("SYNTHETIC"));
        vault.save(&vault.data).unwrap();
        assert_ne!(first, fs::read(&path).unwrap(), "fresh nonce on every save");
        drop(vault);
        assert!(Vault::unlock_legacy(path.clone(), "wrong password").is_err());
        let unlocked = Vault::unlock_legacy(path.clone(), "synthetic password only").unwrap();
        assert_eq!(unlocked.data.token, "SYNTHETIC-TOKEN-MUST-NOT-BE-PLAINTEXT");
        let mut corrupt = fs::read(&path).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        fs::write(&path, corrupt).unwrap();
        assert!(Vault::unlock_legacy(path.clone(), "synthetic password only").is_err());
        assert!(Vault::create(path, "synthetic password only").is_err());
    }
}
