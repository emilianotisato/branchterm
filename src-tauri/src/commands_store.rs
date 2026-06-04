use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreqCommand {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub label: String,
    pub cmd: String,
    pub created_at: String,
}

fn store_path() -> Result<PathBuf, String> {
    let config = dirs::config_dir().ok_or("No config dir")?;
    Ok(config.join("branchterm").join("commands.json"))
}

fn millis_id() -> String {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub fn load() -> Result<Vec<FreqCommand>, String> {
    let path = store_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Read commands.json: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Parse commands.json: {e}"))
}

fn save(commands: &[FreqCommand]) -> Result<(), String> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(commands).map_err(|e| format!("Serialize: {e}"))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &data).map_err(|e| format!("Write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename: {e}"))?;
    Ok(())
}

pub fn add(name: String, label: String, cmd: String) -> Result<FreqCommand, String> {
    let mut commands = load()?;
    let id = millis_id();
    let entry = FreqCommand {
        id: id.clone(),
        name,
        label,
        cmd,
        created_at: id,
    };
    commands.push(entry.clone());
    save(&commands)?;
    Ok(entry)
}

pub fn remove(id: &str) -> Result<(), String> {
    let mut commands = load()?;
    commands.retain(|c| c.id != id);
    save(&commands)
}
