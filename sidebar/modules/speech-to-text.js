/**
 * ===========================================
 * File: speech-to-text.js
 * Purpose: Speech-to-text service abstraction for browser-based STT functionality
 * Dependencies: Web Speech API (window.SpeechRecognition or webkitSpeechRecognition)
 * ===========================================
 */

/**
 * Speech-to-text service using Web Speech API
 * Provides abstraction for easy provider swapping
 */
export class SpeechToTextService {
  constructor() {
    // Get the SpeechRecognition API (Chrome uses webkit prefix)
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = null;
    this.isSupported = !!this.SpeechRecognition;
    this.isRecording = false;
    this.onTranscriptUpdate = null; // Callback for live transcript updates
    this.onFinalTranscript = null; // Callback for final transcript
    this.onError = null; // Callback for errors
    this.permissionState = null; // Track permission state: 'granted', 'denied', 'prompt', or null (unknown)
  }

  /**
   * Check if speech recognition is supported in this browser
   * @returns {boolean} True if supported, false otherwise
   */
  isAvailable() {
    return this.isSupported;
  }

  /**
   * Check microphone permission status using Permissions API
   * Falls back to checking via getUserMedia if Permissions API is not available
   * @returns {Promise<'granted' | 'denied' | 'prompt'>} Permission status
   */
  async checkMicrophonePermission() {

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      console.log("microphone allowed");

    }).catch(error => {
      console.error('[SpeechToTextService] Failed to get microphone permission:', error);
      this.permissionState = null;
      return 'prompt';
    });

    // Check if Permissions API is available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        // Try to query microphone permission
        // Note: Browser support varies - Chrome/Edge use 'microphone', Firefox might not support it
        let permissionStatus = null;
        
        try {
          // Try 'microphone' first (Chrome, Edge)
          permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        } catch (e) {
          // Some browsers don't support 'microphone' in Permissions API
          // Fallback: We'll check via getUserMedia instead
          console.warn('[SpeechToTextService] Permissions API does not support "microphone", will check via getUserMedia:', e);
          // Return null to indicate we need to check via getUserMedia
          this.permissionState = null;
          return 'prompt';
        }
        
        // If we got a permission status, use it
        if (permissionStatus) {
          this.permissionState = permissionStatus.state;
          console.log('[SpeechToTextService] Microphone permission status:', this.permissionState);
          
          // Listen for permission changes
          permissionStatus.onchange = () => {
            this.permissionState = permissionStatus.state;
            console.log('[SpeechToTextService] Microphone permission changed to:', this.permissionState);
          };
          
          return this.permissionState;
        }
      } catch (error) {
        console.warn('[SpeechToTextService] Failed to query permission status:', error);
        // If Permissions API fails, return 'prompt' to allow getUserMedia to handle it
        this.permissionState = null;
        return 'prompt';
      }
    }
    
    // Permissions API not available - return 'prompt' to allow getUserMedia to handle
    this.permissionState = null;
    return 'prompt';
  }

  /**
   * Request microphone permission using MediaDevices API
   * Only requests if permission status is 'prompt' or 'granted', never if 'denied'
   * @returns {Promise<MediaStream>} Media stream if permission granted
   * @throws {Error} If permission denied or no microphone available
   */
  async requestMicrophonePermission() {

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      console.log("microphone allowed");
    }).catch(error => {
      console.error('[SpeechToTextService] Failed to get microphone permission:', error);
      this.permissionState = null;
      return 'prompt';
    });

    // If we already know permission is denied, don't try to request again
    if (this.permissionState === 'denied') {
      throw new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
    }
    
    // Check permission status first
    const permissionStatus = await this.checkMicrophonePermission();
    
    // If permission is already denied, mark it and don't try to request again
    if (permissionStatus === 'denied') {
      this.permissionState = 'denied';
      throw new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
    }
    
    // Check if MediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser');
    }

    try {
      // Request microphone permission (will prompt if status is 'prompt', or succeed if 'granted')
      // Note: Even if permission check returns 'prompt', getUserMedia might immediately throw NotAllowedError
      // if the user previously denied permission (browser behavior can vary)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[SpeechToTextService] Microphone permission granted');
      this.permissionState = 'granted';
      return stream;
    } catch (error) {
      console.error('[SpeechToTextService] Microphone permission error:', error);
      
      // If we get NotAllowedError or PermissionDeniedError, mark permission as denied
      // This ensures we never try to request again in this session
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.permissionState = 'denied';
        throw new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
      }
      
      // Handle other error types
      let errorMessage = 'Microphone access error';
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone and try again.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'Microphone is already in use by another application.';
      } else {
        errorMessage = `Microphone access error: ${error.message || error.name}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get current permission state
   * @returns {'granted' | 'denied' | 'prompt' | null} Current permission state
   */
  getPermissionState() {
    return this.permissionState;
  }

  /**
   * Start recording and transcribing speech
   * @param {Object} options - Configuration options
   * @param {Function} options.onTranscriptUpdate - Callback for live transcript updates (text: string) => void
   * @param {Function} options.onFinalTranscript - Callback for final transcript (text: string) => void
   * @param {Function} options.onError - Callback for errors (error: Error) => void
   * @returns {Promise<void>}
   */
  async startRecording(options = {}) {
    // Check if already recording
    if (this.isRecording) {
      console.warn('[SpeechToTextService] Already recording');
      return;
    }

    // Check if supported
    if (!this.isSupported) {
      const error = new Error('Speech recognition is not supported in this browser');
      if (options.onError) {
        options.onError(error);
      }
      throw error;
    }

    // Store callbacks
    this.onTranscriptUpdate = options.onTranscriptUpdate || null;
    this.onFinalTranscript = options.onFinalTranscript || null;
    this.onError = options.onError || null;

    // Request microphone permission first
    // This will check permission status and only request if not already denied
    let audioStream = null;
    try {
      audioStream = await this.requestMicrophonePermission();
      // Permission granted - we can proceed with recognition
      // Note: We don't need to keep the stream, just need permission
      // Stop all tracks to release the stream (permission remains granted)
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
      }
    } catch (permissionError) {
      // Permission denied or other error - handle gracefully
      console.error('[SpeechToTextService] Microphone permission failed:', permissionError);
      this.isRecording = false;
      
      // Ensure permission state is set to denied if it's a permission error
      if (permissionError.message && permissionError.message.includes('permission denied')) {
        this.permissionState = 'denied';
      }
      
      if (this.onError) {
        this.onError(permissionError);
      }
      throw permissionError;
    }

    try {
      // Create recognition instance
      this.recognition = new this.SpeechRecognition();
      
      // Configure recognition settings
      this.recognition.continuous = true; // Keep listening until stopped
      this.recognition.interimResults = true; // Get interim results for live updates
      this.recognition.lang = 'en-US'; // Default to English (can be made configurable)

      // Handle interim results (live transcript updates)
      this.recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        // Process all results
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          
          if (event.results[i].isFinal) {
            // Final result - add to final transcript
            finalTranscript += transcript + ' ';
          } else {
            // Interim result - add to interim transcript for live updates
            interimTranscript += transcript;
          }
        }

        // Update live transcript if callback provided
        if (this.onTranscriptUpdate && interimTranscript) {
          this.onTranscriptUpdate(interimTranscript);
        }

        // Handle final transcript if available
        if (finalTranscript && this.onFinalTranscript) {
          this.onFinalTranscript(finalTranscript.trim());
        }
      };

      // Handle errors
      this.recognition.onerror = (event) => {
        console.error('[SpeechToTextService] Recognition error:', event.error);
        
        let errorMessage = 'Speech recognition error';
        switch (event.error) {
          case 'no-speech':
            // No speech detected - this is normal, don't treat as error
            return;
          case 'audio-capture':
            errorMessage = 'No microphone found or microphone permission denied. Please check your microphone settings.';
            break;
          case 'not-allowed':
            errorMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
            break;
          case 'network':
            errorMessage = 'Network error during speech recognition';
            break;
          case 'aborted':
            // User stopped recording - this is normal
            return;
          default:
            errorMessage = `Speech recognition error: ${event.error}`;
        }

        // Reset recording state on error
        this.isRecording = false;
        
        const error = new Error(errorMessage);
        if (this.onError) {
          // Call error callback (which will show non-intrusive toast, not alert)
          this.onError(error);
        }
      };

      // Handle end of recognition
      this.recognition.onend = () => {
        // If we were recording and it ended unexpectedly, reset state
        if (this.isRecording) {
          console.log('[SpeechToTextService] Recognition ended');
          this.isRecording = false;
        }
      };

      // Start recognition
      this.recognition.start();
      this.isRecording = true;
      console.log('[SpeechToTextService] Started recording');

    } catch (error) {
      console.error('[SpeechToTextService] Failed to start recording:', error);
      this.isRecording = false;
      
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }

  /**
   * Stop recording and finalize transcription
   * @returns {void}
   */
  stopRecording() {
    if (!this.isRecording || !this.recognition) {
      return;
    }

    try {
      // Stop recognition
      this.recognition.stop();
      this.isRecording = false;
      console.log('[SpeechToTextService] Stopped recording');
    } catch (error) {
      console.error('[SpeechToTextService] Error stopping recording:', error);
      this.isRecording = false;
    }
  }

  /**
   * Check if currently recording
   * @returns {boolean} True if recording, false otherwise
   */
  getRecordingState() {
    return this.isRecording;
  }
}

/**
 * Placeholder function for cloud-based STT (e.g., OpenAI Whisper API)
 * This can be implemented later with actual API integration
 * @param {Blob} audioBlob - Audio blob to transcribe
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudioWithWhisper(audioBlob) {
  // TODO: Implement Whisper API integration
  // Example structure:
  // const formData = new FormData();
  // formData.append('file', audioBlob, 'audio.webm');
  // formData.append('model', 'whisper-1');
  // 
  // const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${YOUR_API_KEY}`,
  //   },
  //   body: formData
  // });
  // 
  // const data = await response.json();
  // return data.text;
  
  throw new Error('Whisper API integration not yet implemented. Please use Web Speech API.');
}



// Function to check microphone permission status and handle accordingly
async function checkMicrophonePermission() {
  const permissionStatus = await navigator.permissions.query({ name: 'microphone' });


  if (permissionStatus.state === 'denied') {
      showPermissionDeniedMessage();
  } else {
      requestMicrophonePermission();
  }
}

// Function to show a custom message when permission is denied
function showPermissionDeniedMessage() {
  // Display a message near the mic button
  const micButton = document.querySelector('#micButton');
  micButton.innerText = "Microphone access denied. Please enable microphone access in your browser settings.";
  micButton.style.color = 'red';
  micButton.addEventListener('click', () => {
      openBrowserSettings();
  });
}

// Function to guide the user to open browser settings
function openBrowserSettings() {
  // Provide instructions to open settings or guide them to the appropriate settings page
  window.open("chrome://settings/content/microphone", "_blank");
}

// Function to request microphone permission
async function requestMicrophonePermission() {
  try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecording(); // Start the recording if permission is granted
  } catch (error) {
      console.error("Microphone permission error:", error);
      showPermissionDeniedMessage();
  }
}