/**
 * Service to interact with the Groq Whisper API for speech-to-text.
 */

const DEFAULT_PROXY = 'https://corsproxy.io/?';
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Whisper silence hallucinations database
const HALLUCINATION_PHRASES = [
  /subtitles by the amara\.org community/i,
  /please subscribe/i,
  /thank you for watching/i,
  /please like and subscribe/i,
  /support me on patreon/i,
  /translated by/i,
  /subtitle by/i,
  /amara\.org/i,
  /thank you very much/i,
  /watch more videos/i,
  /subscribe to my channel/i,
  /watch video/i,
];

function isHallucination(text) {
  const cleanText = text.trim();
  // Filter out empty text or one-character junk outputs (like dot, comma, single vowel)
  if (!cleanText || cleanText.length <= 1) return true;
  return HALLUCINATION_PHRASES.some(regex => regex.test(cleanText));
}

export async function transcribeAudio(audioBlob, apiKey, options = {}) {
  const {
    model = 'whisper-large-v3',
    language = '',
    prompt = '',
    temperature = 0.0,
    corsProxy = DEFAULT_PROXY,
    disableProxy = false
  } = options;

  if (!apiKey) {
    throw new Error('Groq API Key is required. Please add it in the settings.');
  }

  // Create form data for multipart/form-data upload
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');

  if (language) {
    formData.append('language', language);
  }
  if (prompt) {
    formData.append('prompt', prompt);
  }
  formData.append('temperature', temperature.toString());

  // Determine target URL (with or without CORS proxy)
  const targetUrl = disableProxy 
    ? GROQ_TRANSCRIPTION_URL 
    : `${corsProxy}${GROQ_TRANSCRIPTION_URL}`;

  const headers = {
    'Authorization': `Bearer ${apiKey}`
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    if (!response.ok) {
      let errorMessage = `API error (${response.status})`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        // Fallback if response is not JSON
        const errorText = await response.text();
        if (errorText) errorMessage = errorText.substring(0, 100);
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();

    if (!result.segments || !Array.isArray(result.segments)) {
      if (result.text && !isHallucination(result.text)) {
        // If segments are missing but text exists, create a fallback single segment
        return [{
          id: `cap-${Date.now()}-0`,
          start: 0,
          end: audioBlob.duration || 10,
          text: result.text.trim(),
          x: 50,
          y: 80,
          scale: 1,
          style: {}
        }];
      }
      return [];
    }

    // Filter out segments that are silent hallucinations
    const validSegments = result.segments.filter(segment => !isHallucination(segment.text));

    // Map segments to our app's caption model
    return validSegments.map((segment, index) => ({
      id: `cap-${Date.now()}-${index}`,
      start: parseFloat(segment.start.toFixed(2)),
      end: parseFloat(segment.end.toFixed(2)),
      text: segment.text.trim(),
      // Default layout settings for every subtitle card
      x: 50,  // centered percentage (X)
      y: 80,  // bottom percentage (Y)
      scale: 1, // zoom scale
      style: {} // segment-specific styling overrides if any
    }));

  } catch (error) {
    console.error('Transcription service error:', error);
    throw new Error(`Groq Transcription Failed: ${error.message}`);
  }
}
