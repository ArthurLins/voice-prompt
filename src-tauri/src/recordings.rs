//! Local recovery files and lossless, pause-aware PCM chunking.
use std::path::{Path, PathBuf};

pub const MAX_SECONDS: usize = 30 * 60;
const RATE: usize = 16_000;

pub fn path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid recording ID.")?;
    Ok(dir.join(format!("{id}.wav")))
}

pub fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 46
        || bytes.len() > RATE * 2 * MAX_SECONDS + 44
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || &bytes[12..16] != b"fmt "
        || &bytes[36..40] != b"data"
    {
        return Err("Invalid audio or recording longer than 30 minutes.".into());
    }
    let u32_at = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
    if u32_at(4) != bytes.len() - 8
        || u32_at(16) != 16
        || u32_at(40) != bytes.len() - 44
        || (bytes.len() - 44) % 2 != 0
        || bytes[20..24] != [1, 0, 1, 0]
        || u32_at(24) != RATE
        || u32_at(28) != RATE * 2
        || bytes[32..36] != [2, 0, 16, 0]
    {
        return Err("Audio must be mono PCM, 16 kHz and 16-bit with valid lengths.".into());
    }
    Ok(())
}

pub fn chunks(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    validate(bytes)?;
    let pcm = &bytes[44..];
    let mut start = 0;
    let mut result = Vec::new();
    while start < pcm.len() {
        let mut end = (start + RATE * 2 * 60).min(pcm.len());
        if end < pcm.len() {
            // Prefer the quietest 20 ms window in the final 15 seconds.
            let window = RATE * 2 / 50;
            let search = start + RATE * 2 * 45;
            let quiet = (search..=end - window)
                .step_by(window)
                .min_by_key(|&i| {
                    pcm[i..i + window]
                        .chunks_exact(2)
                        .map(|s| {
                            let x = i16::from_le_bytes([s[0], s[1]]) as i64;
                            x * x
                        })
                        .sum::<i64>()
                })
                .unwrap_or(end - window);
            end = quiet + window / 2;
        }
        let mut chunk = bytes[..44].to_vec();
        chunk.extend_from_slice(&pcm[start..end]);
        let size = chunk.len();
        chunk[4..8].copy_from_slice(&((size - 8) as u32).to_le_bytes());
        chunk[40..44].copy_from_slice(&((size - 44) as u32).to_le_bytes());
        result.push(chunk);
        start = end;
    }
    Ok(result)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Checkpoint {
    model: String,
    language: String,
    chunks: Vec<String>,
}
pub fn load_checkpoint(path: &Path, model: &str, language: &str, count: usize) -> Vec<String> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Checkpoint>(&b).ok())
        .filter(|c| c.model == model && c.language == language && c.chunks.len() <= count)
        .map(|c| c.chunks)
        .unwrap_or_default()
}
pub fn save_checkpoint(
    path: &Path,
    model: &str,
    language: &str,
    chunks: &[String],
) -> Result<(), String> {
    let checkpoint = Checkpoint {
        model: model.into(),
        language: language.into(),
        chunks: chunks.to_vec(),
    };
    let bytes = serde_json::to_vec(&checkpoint).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wav(seconds: usize) -> Vec<u8> {
        let mut b = vec![0; 44 + seconds * RATE * 2];
        b[..4].copy_from_slice(b"RIFF");
        b[8..16].copy_from_slice(b"WAVEfmt ");
        b[16..20].copy_from_slice(&16u32.to_le_bytes());
        b[20..24].copy_from_slice(&[1, 0, 1, 0]);
        b[24..28].copy_from_slice(&(RATE as u32).to_le_bytes());
        b[28..32].copy_from_slice(&((RATE * 2) as u32).to_le_bytes());
        b[32..36].copy_from_slice(&[2, 0, 16, 0]);
        b[36..40].copy_from_slice(b"data");
        let n = b.len();
        b[4..8].copy_from_slice(&((n - 8) as u32).to_le_bytes());
        b[40..44].copy_from_slice(&((n - 44) as u32).to_le_bytes());
        b
    }
    #[test]
    fn resumes_completed_parts_and_invalidates_changed_settings() {
        let path =
            std::env::temp_dir().join(format!("voice-prompt-test-{}.json", uuid::Uuid::new_v4()));
        let done = vec![
            "Quero um aplicativo".into(),
            "".into(),
            "sem traduzir minha entrada".into(),
        ];
        save_checkpoint(&path, "small", "pt", &done).unwrap();
        assert_eq!(load_checkpoint(&path, "small", "pt", 5), done);
        assert!(load_checkpoint(&path, "large-v3-turbo-q5_0", "pt", 5).is_empty());
        assert!(load_checkpoint(&path, "small", "en", 5).is_empty());
        assert!(load_checkpoint(&path, "small", "pt", 2).is_empty());
        save_checkpoint(&path, "small", "pt", &["replacement".into()]).unwrap();
        assert_eq!(
            load_checkpoint(&path, "small", "pt", 5),
            vec!["replacement"]
        );
        std::fs::write(&path, b"broken").unwrap();
        assert!(load_checkpoint(&path, "small", "pt", 5).is_empty());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn long_audio_preserves_every_sample_in_order() {
        let mut input = wav(601);
        for (i, b) in input[44..].iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        let parts = chunks(&input).unwrap();
        assert!(parts.len() > 10);
        for part in &parts {
            validate(part).unwrap();
            assert!(part.len() <= 44 + 60 * RATE * 2);
        }
        assert_eq!(
            parts
                .iter()
                .flat_map(|c| c[44..].iter().copied())
                .collect::<Vec<_>>(),
            input[44..]
        );
    }
    #[test]
    fn validates_duration_lengths_and_paths() {
        assert!(validate(&wav(MAX_SECONDS)).is_ok());
        assert!(validate(&wav(MAX_SECONDS + 1)).is_err());
        let mut bad = wav(1);
        bad.pop();
        assert!(validate(&bad).is_err());
        assert!(path(Path::new("recordings"), "../secret").is_err());
    }
}
