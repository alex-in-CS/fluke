//! API keys live in the OS credential store (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux). They are read only in the Rust core and never sent to the webview.

use crate::error::{AppError, Result};

const SERVICE: &str = "in.alexincs.fluke";

fn entry(provider_id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("provider:{provider_id}"))
        .map_err(|e| AppError::Keyring(e.to_string()))
}

pub fn set(provider_id: &str, key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return delete(provider_id);
    }
    entry(provider_id)?
        .set_password(key)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

pub fn get(provider_id: &str) -> Result<Option<String>> {
    match entry(provider_id)?.get_password() {
        Ok(k) if !k.is_empty() => Ok(Some(k)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

pub fn delete(provider_id: &str) -> Result<()> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

/// Last 4 characters, for "sk-…a1b2" style display.
pub fn hint(provider_id: &str) -> Option<String> {
    get(provider_id).ok().flatten().map(|k| {
        let tail: String = k
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("…{tail}")
    })
}
