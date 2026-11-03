//! Authenticated local files. The encryption key lives in the OS credential store.
use ring::{
    aead::{self, Aad, LessSafeKey, Nonce, UnboundKey},
    rand::{SecureRandom, SystemRandom},
};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

const MAGIC: &[u8] = b"VPENC1\0";
const NONCE_SIZE: usize = 12;

pub struct Storage(LessSafeKey);

impl Storage {
    pub fn open(dir: &Path) -> Result<Self, String> {
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(".storage-key.lock"))
            .map_err(|_| "Could not lock the local storage key.")?;
        lock.lock()
            .map_err(|_| "Could not lock the local storage key.")?;
        let entry = keyring::Entry::new("VoicePrompt", "encrypted-local-storage-v1")
            .map_err(|_| "Could not open the local storage key.")?;
        let key = match entry.get_secret() {
            Ok(key) => key,
            Err(keyring::Error::NoEntry) => {
                let mut key = vec![0; 32];
                SystemRandom::new()
                    .fill(&mut key)
                    .map_err(|_| "Could not generate a storage key.")?;
                entry
                    .set_secret(&key)
                    .map_err(|_| "Could not save the local storage key.")?;
                key
            }
            Err(_) => return Err("Could not read the local storage key.".into()),
        };
        Self::from_key(&key)
    }

    pub(crate) fn from_key(key: &[u8]) -> Result<Self, String> {
        let key =
            UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "Invalid local storage key.")?;
        Ok(Self(LessSafeKey::new(key)))
    }

    fn aad(path: &Path) -> Result<Aad<&str>, String> {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(Aad::from)
            .ok_or_else(|| "Invalid local storage filename.".into())
    }

    fn lock_data(path: &Path) -> Result<fs::File, String> {
        let dir = path.parent().ok_or("Invalid local storage path.")?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(".storage-data.lock"))
            .map_err(|error| error.to_string())?;
        lock.lock().map_err(|error| error.to_string())?;
        Ok(lock)
    }

    pub fn migrate(&self, path: &Path) -> Result<(), String> {
        let _lock = Self::lock_data(path)?;
        let mut file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        let mut header = [0; MAGIC.len()];
        match file.read_exact(&mut header) {
            Ok(()) if header == MAGIC => return Ok(()),
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {}
            Err(error) => return Err(error.to_string()),
        }
        drop(file);
        self.write_file(path, &fs::read(path).map_err(|error| error.to_string())?)
    }

    pub fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        let _lock = Self::lock_data(path)?;
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let Some(sealed) = bytes.strip_prefix(MAGIC) else {
            // Upgrade legacy plaintext in place. A failed write preserves it.
            self.write_file(path, &bytes)?;
            return Ok(bytes);
        };
        let (nonce, body) = sealed
            .split_at_checked(NONCE_SIZE)
            .ok_or("Invalid encrypted file.")?;
        let nonce =
            Nonce::try_assume_unique_for_key(nonce).map_err(|_| "Invalid storage nonce.")?;
        let mut body = body.to_vec();
        let len = self
            .0
            .open_in_place(nonce, Self::aad(path)?, &mut body)
            .map_err(|_| "Could not authenticate local data with the current storage key.")?
            .len();
        body.truncate(len);
        Ok(body)
    }

    pub fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        let _lock = Self::lock_data(path)?;
        self.write_file(path, bytes)
    }

    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        let mut nonce = [0; NONCE_SIZE];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| "Could not generate a storage nonce.")?;
        let mut body = bytes.to_vec();
        self.0
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Self::aad(path)?,
                &mut body,
            )
            .map_err(|_| "Could not encrypt local data.")?;
        let dir = path.parent().ok_or("Invalid local storage path.")?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|error| error.to_string())?;
        file.write_all(MAGIC)
            .and_then(|_| file.write_all(&nonce))
            .and_then(|_| file.write_all(&body))
            .and_then(|_| file.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        file.persist(path).map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_plaintext_and_rejects_copied_or_modified_ciphertext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        let other = dir.path().join("other.json");
        let storage = Storage::from_key(&[42; 32]).unwrap();
        fs::write(&path, b"legacy private text").unwrap();
        assert_eq!(storage.read(&path).unwrap(), b"legacy private text");
        let mut ciphertext = fs::read(&path).unwrap();
        assert!(ciphertext.starts_with(MAGIC));
        assert_eq!(storage.read(&path).unwrap(), b"legacy private text");
        fs::write(&other, &ciphertext).unwrap();
        assert!(storage.read(&other).is_err());
        *ciphertext.last_mut().unwrap() ^= 1;
        fs::write(&path, ciphertext).unwrap();
        assert!(storage.read(&path).is_err());
    }
}
