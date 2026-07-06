/**
 * Utility to extract audio from a video file in the browser,
 * downsample it to 16kHz mono, and return it as a WAV Blob.
 */

export async function extractAudio(videoFile, onProgress) {
  if (onProgress) onProgress('Reading video file...');
  const arrayBuffer = await videoFile.arrayBuffer();

  if (onProgress) onProgress('Decoding audio track from video...');
  
  // AudioContext needs to support both standard and webkit prefixes
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.error('Failed to decode audio data:', error);
    throw new Error('Could not decode audio from video. Make sure the video has an audio track.');
  } finally {
    audioCtx.close();
  }

  const duration = audioBuffer.duration;
  const targetSampleRate = 16000;
  const numberOfChannels = 1; // mono

  if (onProgress) onProgress('Downsampling audio to 16kHz mono...');
  
  // Downsample natively using OfflineAudioContext
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offlineCtx = new OfflineAudioContextClass(
    numberOfChannels,
    Math.round(duration * targetSampleRate),
    targetSampleRate
  );

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = audioBuffer;

  // Add low-pass filter to prevent aliasing distortion
  const lowPassFilter = offlineCtx.createBiquadFilter();
  lowPassFilter.type = 'lowpass';
  // Cutoff at 7.5kHz (slightly below Nyquist limit of 8kHz for 16kHz sample rate)
  lowPassFilter.frequency.value = 7500;
  lowPassFilter.Q.value = 0.707;

  // Connect: Source -> LowPass -> Destination
  bufferSource.connect(lowPassFilter);
  lowPassFilter.connect(offlineCtx.destination);
  
  bufferSource.start();

  const renderedBuffer = await offlineCtx.startRendering();

  if (onProgress) onProgress('Encoding audio to WAV format...');
  const wavBlob = bufferToWav(renderedBuffer);

  return {
    blob: wavBlob,
    duration: duration
  };
}

/**
 * Encodes an AudioBuffer into a WAV Blob.
 */
function bufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = Raw uncompressed PCM
  const bitDepth = 16;
  
  const result = buffer.getChannelData(0); // Mono channel
  const bufferLength = result.length * 2; // 16-bit = 2 bytes per sample
  const wavBuffer = new ArrayBuffer(44 + bufferLength);
  const view = new DataView(wavBuffer);
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + bufferLength, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* chunk length */
  view.setUint32(40, bufferLength, true);
  
  /* write PCM audio samples */
  floatTo16BitPCM(view, 44, result);
  
  return new Blob([view], { type: 'audio/wav' });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    // Scale standard float [-1.0, 1.0] to signed 16-bit integer range [-32768, 32767]
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
