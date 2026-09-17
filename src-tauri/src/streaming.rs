use eventsource_stream::Event;
use futures_util::{Stream, StreamExt};
use serde_json::Value;

pub async fn collect<S, E>(
    mut events: S,
    mut on_delta: impl FnMut(String),
) -> Result<String, String>
where
    S: Stream<Item = Result<Event, E>> + Unpin,
{
    let mut output = String::new();
    let mut finished = false;
    while let Some(event) = events.next().await {
        let event =
            event.map_err(|_| "The connection was interrupted. Your transcript was preserved.")?;
        if event.data == "[DONE]" {
            finished = true;
            break;
        }
        let value: Value =
            serde_json::from_str(&event.data).map_err(|_| "The API sent an invalid event.")?;
        if value.get("error").is_some() {
            return Err("The provider reported a generation error. Please try again.".into());
        }
        if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
            if reason != "stop" {
                return Err(format!(
                    "Incomplete generation ({reason}). Your transcript was preserved."
                ));
            }
            finished = true;
        }
        if let Some(delta) = value["choices"][0]["delta"]["content"].as_str() {
            output.push_str(delta);
            if output.len() > 100_000 {
                return Err("Response exceeded the size limit.".into());
            }
            on_delta(delta.to_owned());
        }
    }
    if !finished {
        return Err(
            "The connection ended before completion. Your transcript was preserved.".into(),
        );
    }
    if output.trim().is_empty() {
        return Err("The model returned an empty response.".into());
    }
    Ok(output.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use eventsource_stream::Eventsource;
    use futures_util::stream;
    async fn run(s: &str) -> Result<String, String> {
        // Split every byte, including inside accented UTF-8 characters and CRLF boundaries.
        let chunks: Vec<Result<Vec<u8>, std::io::Error>> =
            s.as_bytes().iter().map(|b| Ok(vec![*b])).collect();
        collect(stream::iter(chunks).eventsource(), |_| {}).await
    }
    #[tokio::test]
    async fn parses_fragmented_utf8_and_heartbeats() {
        let data = ": keep-alive\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Crie uma ação.\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
        assert_eq!(run(data).await.unwrap(), "Crie uma ação.");
    }
    #[tokio::test]
    async fn detects_disconnect_and_token_limit() {
        assert!(
            run("data: {\"choices\":[{\"delta\":{\"content\":\"Parcial\"}}]}\n\n")
                .await
                .unwrap_err()
                .contains("before completion")
        );
        assert!(
            run("data: {\"choices\":[{\"finish_reason\":\"length\"}]}\n\n")
                .await
                .unwrap_err()
                .contains("Incomplete")
        );
    }
    #[tokio::test]
    async fn accepts_usage_chunks_and_rejects_error_after_content() {
        let chunks = [
            serde_json::json!({"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}),
            serde_json::json!({"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":42}}),
            serde_json::json!({"choices":[],"usage":{"total_tokens":42}}),
        ];
        let mut data = chunks
            .iter()
            .map(|c| format!("data: {c}\n\n"))
            .collect::<String>();
        data.push_str("data: [DONE]\n\n");
        assert_eq!(run(&data).await.unwrap(), "Complete");
        let error = format!(
            "data: {}\n\ndata: {}\n\n",
            serde_json::json!({"choices":[{"delta":{"content":"Partial"}}]}),
            serde_json::json!({"error":{"code":502},"choices":[{"finish_reason":"error"}]})
        );
        assert!(run(&error).await.is_err());
    }
    #[tokio::test]
    async fn detects_provider_error_and_empty_output() {
        assert!(run("data: {\"error\":{\"code\":429}}\n\n").await.is_err());
        assert!(run("data: [DONE]\n\n").await.unwrap_err().contains("empty"));
    }
}
