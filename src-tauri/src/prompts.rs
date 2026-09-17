use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
#[derive(Clone, Deserialize, Serialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub language: String,
    pub tone: String,
    pub instructions: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub editor_instructions: String,
    pub prompt_profiles: Vec<Profile>,
}
pub fn defaults() -> Defaults {
    serde_json::from_str(include_str!("../../src/prompt-defaults.json"))
        .expect("Bundled prompt definitions must be valid")
}
pub fn default_mode() -> String {
    "auto".into()
}
pub fn default_instructions() -> String {
    defaults().editor_instructions
}
pub fn default_profiles() -> Vec<Profile> {
    defaults().prompt_profiles
}
pub fn build_messages(
    mode: &str,
    instructions: &str,
    profiles: &[Profile],
    transcript: &str,
    previous: &str,
    style: &str,
) -> Result<Value, String> {
    if instructions.trim().is_empty() || instructions.chars().count() > 12000 {
        return Err("Invalid general instructions.".into());
    }
    if profiles.is_empty() || profiles.len() > 16 {
        return Err("Use between 1 and 16 prompt types.".into());
    }
    let mut ids = HashSet::new();
    for p in profiles {
        if p.id.is_empty()
            || p.id.len() > 80
            || !ids.insert(&p.id)
            || p.id == "auto"
            || p.name.trim().is_empty()
            || p.name.chars().count() > 60
            || p.description.trim().is_empty()
            || p.description.chars().count() > 1000
            || p.instructions.trim().is_empty()
            || p.instructions.chars().count() > 6000
            || !matches!(p.language.as_str(), "en" | "pt" | "source")
            || !matches!(p.tone.as_str(), "assertive" | "neutral")
        {
            return Err("Invalid prompt type definition. Review the settings.".into());
        }
    }
    let selected = if mode == "auto" {
        profiles.iter().collect::<Vec<_>>()
    } else {
        vec![profiles
            .iter()
            .find(|p| p.id == mode)
            .ok_or("Prompt type not found.")?]
    };
    let definitions = json!({ "modo": mode, "operacao": if previous.trim().is_empty() { "novo" } else { "refinar" }, "instrucoes_gerais": instructions, "perfis": selected });
    Ok(json!([
        { "role": "system", "content": format!("{}\n\nEditor settings (JSON):\n{}", include_str!("prompt.txt"), definitions) },
        { "role": "user", "content": json!({"ditado": transcript, "prompt_anterior": previous, "estilo":style}).to_string() }
    ]))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn code_defaults_are_english_and_assertive() {
        let d = defaults();
        let code = d.prompt_profiles.iter().find(|p| p.id == "code").unwrap();
        assert_eq!(code.language, "en");
        assert_eq!(code.tone, "assertive");
        let messages = build_messages(
            "code",
            &d.editor_instructions,
            &d.prompt_profiles,
            "Corrija o login",
            "",
            "conciso",
        )
        .unwrap();
        let system = messages[0]["content"].as_str().unwrap();
        let config: Value =
            serde_json::from_str(system.split("Editor settings (JSON):\n").nth(1).unwrap())
                .unwrap();
        assert_eq!(config["perfis"].as_array().unwrap().len(), 1);
        assert_eq!(config["perfis"][0]["language"], "en");
        assert_eq!(config["operacao"], "novo");
        assert!(!system.contains("Corrija o login"));
    }
    #[test]
    fn custom_rules_and_previous_prompt_reach_the_request() {
        let mut d = defaults();
        d.prompt_profiles[0].instructions = "Use numbered requirements.".into();
        d.prompt_profiles[0].language = "pt".into();
        let msgs = build_messages(
            "auto",
            "Preserve all constraints.",
            &d.prompt_profiles,
            "Add export",
            "Build a task app",
            "equilibrado",
        )
        .unwrap();
        assert!(msgs[0]["content"]
            .as_str()
            .unwrap()
            .contains("Use numbered requirements."));
        assert!(msgs[0]["content"]
            .as_str()
            .unwrap()
            .contains("Preserve all constraints."));
        let input: Value = serde_json::from_str(msgs[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(input["prompt_anterior"], "Build a task app");
        let system = msgs[0]["content"].as_str().unwrap();
        let config: Value =
            serde_json::from_str(system.split("Editor settings (JSON):\n").nth(1).unwrap())
                .unwrap();
        assert_eq!(config["operacao"], "refinar");
    }
    #[test]
    fn portuguese_input_is_not_translated_before_processing() {
        let d = defaults();
        let original = "Quero um plano, sem implementar. Não remova as restrições.";
        let previous = "Preserve este texto em português.";
        let messages = build_messages(
            "auto",
            &d.editor_instructions,
            &d.prompt_profiles,
            original,
            previous,
            "conciso",
        )
        .unwrap();
        let input: Value = serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(input["ditado"], original);
        assert_eq!(input["prompt_anterior"], previous);
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .starts_with("You are a prompt editor."));
    }
    #[test]
    fn invalid_catalogs_and_selections_fail_before_network() {
        let mut d = defaults();
        assert!(build_messages(
            "missing",
            &d.editor_instructions,
            &d.prompt_profiles,
            "x",
            "",
            "conciso"
        )
        .is_err());
        d.prompt_profiles.push(d.prompt_profiles[0].clone());
        assert!(build_messages(
            "auto",
            &d.editor_instructions,
            &d.prompt_profiles,
            "x",
            "",
            "conciso"
        )
        .is_err());
    }
}
