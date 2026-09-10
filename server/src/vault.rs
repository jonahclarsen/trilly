use crate::model::Data;
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rand::{RngCore, rngs::OsRng};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

// Version fixes the KDF parameters and payload layout. Never silently change them.
const MAGIC: &[u8; 8] = b"YNPLUS01";
const HEADER: usize = 8 + 16 + 24;

pub struct Vault {
    pub path: PathBuf,
    salt: [u8; 16],
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
            salt,
            key: derive(password, &salt)?,
            data: Data::default(),
        };
        vault.save(&vault.data)?;
        Ok(vault)
    }

    pub fn unlock(path: PathBuf, password: &str) -> Result<Self, String> {
        let bytes = fs::read(&path).map_err(|_| "Could not read vault")?;
        if bytes.len() < HEADER + 16 || &bytes[..8] != MAGIC {
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
            salt,
            key,
            data,
        })
    }

    pub fn save(&self, data: &Data) -> Result<(), String> {
        let plain = Zeroizing::new(serde_json::to_vec(data).map_err(|_| "Could not encode vault")?);
        let cipher = XChaCha20Poly1305::new(self.key.as_ref().into());
        let mut nonce = [0; 24];
        OsRng.fill_bytes(&mut nonce);
        let mut bytes = Vec::from(MAGIC.as_slice());
        bytes.extend_from_slice(&self.salt);
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
        assert!(Vault::unlock(path.clone(), "wrong password").is_err());
        let unlocked = Vault::unlock(path.clone(), "synthetic password only").unwrap();
        assert_eq!(unlocked.data.token, "SYNTHETIC-TOKEN-MUST-NOT-BE-PLAINTEXT");
        let mut corrupt = fs::read(&path).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        fs::write(&path, corrupt).unwrap();
        assert!(Vault::unlock(path.clone(), "synthetic password only").is_err());
        assert!(Vault::create(path, "synthetic password only").is_err());
    }
}
