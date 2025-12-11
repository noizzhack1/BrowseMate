/**
 * Text-to-Speech Service
 * Provides text-to-speech functionality using the Web Speech API
 */

class TextToSpeechService {
  constructor() {
    this.synthesis = window.speechSynthesis;
    this.currentUtterance = null;
    this.voices = [];
    this.voicesLoaded = false;
    this.enabled = true;
    this.settings = {
      voice: null, // Will be set to default
      pitch: 1,
      rate: 1,
      volume: 1
    };
    
    // Queue for pending speech requests
    this.speechQueue = [];
    this.isProcessingQueue = false;
    
    // Load voices when they become available
    this.loadVoices();
    
    // Some browsers load voices asynchronously
    if (this.synthesis.onvoiceschanged !== undefined) {
      this.synthesis.onvoiceschanged = () => {
        this.loadVoices();
      };
    }
    
    // Ensure voices are loaded after a delay (fallback)
    setTimeout(() => {
      if (!this.voicesLoaded) {
        this.loadVoices();
      }
    }, 1000);
  }
  
  /**
   * Load available voices from the browser
   */
  loadVoices() {
    this.voices = this.synthesis.getVoices();
    
    if (this.voices.length > 0) {
      this.voicesLoaded = true;
      console.log(`[TTS] Loaded ${this.voices.length} voices`);
      
      // Set default voice if not already set
      if (!this.settings.voice) {
        // Try to find a good default English voice
        const defaultVoice = this.voices.find(voice => 
          voice.lang.startsWith('en') && voice.default
        ) || this.voices.find(voice => 
          voice.lang.startsWith('en')
        ) || this.voices[0];
        
        this.settings.voice = defaultVoice;
        console.log(`[TTS] Selected default voice: ${defaultVoice?.name || 'none'}`);
      }
      
      // Process any queued speech requests
      this.processQueue();
    }
  }
  
  /**
   * Wait for voices to be loaded
   * @returns {Promise<void>}
   */
  waitForVoices() {
    return new Promise((resolve) => {
      if (this.voicesLoaded && this.voices.length > 0) {
        resolve();
        return;
      }
      
      // Set up a one-time listener for voices changed
      const checkVoices = () => {
        if (this.voicesLoaded && this.voices.length > 0) {
          resolve();
        } else {
          // Retry after a short delay
          setTimeout(() => {
            this.loadVoices();
            if (this.voicesLoaded && this.voices.length > 0) {
              resolve();
            } else {
              // Give up after 2 seconds and resolve anyway
              setTimeout(resolve, 2000);
            }
          }, 100);
        }
      };
      
      checkVoices();
    });
  }
  
  /**
   * Check if TTS is available in the browser
   * @returns {boolean} True if TTS is available
   */
  isAvailable() {
    return 'speechSynthesis' in window;
  }
  
  /**
   * Check if TTS is currently enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.enabled && this.isAvailable();
  }
  
  /**
   * Enable or disable TTS
   * @param {boolean} enabled - Whether to enable TTS
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    // Stop any ongoing speech when disabling
    if (!enabled && this.synthesis.speaking) {
      this.stop();
    }
  }
  
  /**
   * Update TTS settings
   * @param {Object} settings - Settings object with voice, pitch, rate, volume
   */
  updateSettings(settings) {
    if (settings.voice !== undefined) {
      // Find voice by name
      const voice = this.voices.find(v => v.name === settings.voice);
      if (voice) {
        this.settings.voice = voice;
      }
    }
    
    if (settings.pitch !== undefined) {
      this.settings.pitch = Math.max(0, Math.min(2, settings.pitch));
    }
    
    if (settings.rate !== undefined) {
      this.settings.rate = Math.max(0.1, Math.min(10, settings.rate));
    }
    
    if (settings.volume !== undefined) {
      this.settings.volume = Math.max(0, Math.min(1, settings.volume));
    }
  }
  
  /**
   * Get current settings
   * @returns {Object} Current TTS settings
   */
  getSettings() {
    return {
      ...this.settings,
      voice: this.settings.voice ? this.settings.voice.name : null
    };
  }
  
  /**
   * Get available voices
   * @returns {Array} Array of available voice objects
   */
  getVoices() {
    return this.voices.map(voice => ({
      name: voice.name,
      lang: voice.lang,
      default: voice.default,
      localService: voice.localService
    }));
  }
  
  /**
   * Speak the given text
   * @param {string} text - The text to speak
   * @param {Object} callbacks - Optional callbacks (onStart, onEnd, onError)
   * @returns {Promise<void>}
   */
  async speak(text, callbacks = {}) {
    console.log(`[TTS speak] Called with text length: ${text?.length}, enabled: ${this.enabled}`);
    
    // Check if TTS is available and enabled
    if (!this.isAvailable()) {
      const error = new Error('Text-to-Speech is not supported in this browser');
      console.error('[TTS speak] TTS not available');
      if (callbacks.onError) callbacks.onError(error);
      throw error;
    }
    
    if (!this.enabled) {
      console.log('[TTS speak] TTS is disabled, skipping');
      // Silently resolve if disabled
      return;
    }
    
    // Clean the text (remove markdown, HTML, etc.)
    const cleanText = this.cleanText(text);
    
    if (!cleanText.trim()) {
      console.log('[TTS speak] Text is empty after cleaning, skipping');
      return;
    }
    
    console.log(`[TTS speak] Clean text: "${cleanText.substring(0, 50)}..."`);
    
    // Wait for voices to be loaded
    await this.waitForVoices();
    
    console.log('[TTS speak] Voices loaded, adding to queue');
    
    // Add to queue and process
    return new Promise((resolve, reject) => {
      this.speechQueue.push({
        text: cleanText,
        callbacks,
        resolve,
        reject
      });
      
      console.log(`[TTS speak] Added to queue. Queue length now: ${this.speechQueue.length}`);
      this.processQueue();
    });
  }
  
  /**
   * Process the speech queue
   */
  async processQueue() {
    // Already processing or nothing to process
    if (this.isProcessingQueue || this.speechQueue.length === 0) {
      console.log(`[TTS processQueue] Already processing: ${this.isProcessingQueue}, Queue length: ${this.speechQueue.length}`);
      return;
    }
    
    console.log(`[TTS processQueue] Starting queue processing. Queue length: ${this.speechQueue.length}`);
    this.isProcessingQueue = true;
    
    while (this.speechQueue.length > 0) {
      // Get the next item (remove all but the last one to avoid backlog)
      const item = this.speechQueue[this.speechQueue.length - 1];
      this.speechQueue = []; // Clear queue, only speak the latest
      
      console.log(`[TTS processQueue] Processing item: "${item.text.substring(0, 50)}..."`);
      
      try {
        await this.speakNow(item.text, item.callbacks);
        item.resolve();
        console.log('[TTS processQueue] Item processed successfully');
      } catch (error) {
        console.error('[TTS processQueue] Error processing item:', error);
        item.reject(error);
      }
    }
    
    console.log('[TTS processQueue] Queue processing complete');
    this.isProcessingQueue = false;
  }
  
  /**
   * Speak text immediately (internal method)
   * @param {string} cleanText - The cleaned text to speak
   * @param {Object} callbacks - Optional callbacks (onStart, onEnd, onError)
   * @returns {Promise<void>}
   */
  speakNow(cleanText, callbacks = {}) {
    return new Promise((resolve, reject) => {
      console.log(`[TTS speakNow] Starting speech for text: "${cleanText.substring(0, 50)}..."`);
      console.log(`[TTS speakNow] Voice loaded: ${this.voicesLoaded}, Voice set: ${!!this.settings.voice}`);
      
      const continueSpeaking = () => {
        console.log('[TTS speakNow] Creating SpeechSynthesisUtterance');
        
        // Create utterance
        this.currentUtterance = new SpeechSynthesisUtterance(cleanText);
        
        // Apply settings
        if (this.settings.voice) {
          this.currentUtterance.voice = this.settings.voice;
          console.log(`[TTS speakNow] Using voice: ${this.settings.voice.name} (${this.settings.voice.lang})`);
        } else {
          console.warn('[TTS speakNow] No voice set - using browser default');
        }
        this.currentUtterance.pitch = this.settings.pitch;
        this.currentUtterance.rate = this.settings.rate;
        this.currentUtterance.volume = this.settings.volume;
        
        // Workaround for Chrome bug where synthesis stops after 15 seconds
        // Resume every 10 seconds to keep it alive
        let resumeInterval = null;
        
        // Set up event handlers
        this.currentUtterance.onstart = () => {
          console.log('[TTS speakNow] ✓ Speech started successfully');
          if (callbacks.onStart) callbacks.onStart();
          
          // Start the keep-alive interval for long texts
          resumeInterval = setInterval(() => {
            if (this.synthesis.speaking && !this.synthesis.paused) {
              this.synthesis.pause();
              this.synthesis.resume();
            }
          }, 10000);
        };
        
        this.currentUtterance.onend = () => {
          if (resumeInterval) clearInterval(resumeInterval);
          console.log('[TTS speakNow] ✓ Speech completed successfully');
          this.currentUtterance = null;
          if (callbacks.onEnd) callbacks.onEnd();
          resolve();
        };
        
        this.currentUtterance.onerror = (event) => {
          if (resumeInterval) clearInterval(resumeInterval);
          console.error(`[TTS speakNow] ✗ Speech error: ${event.error}`);
          this.currentUtterance = null;
          
          // Don't treat 'interrupted' or 'canceled' as errors - they're expected
          if (event.error === 'interrupted' || event.error === 'canceled') {
            console.log('[TTS speakNow] Speech was interrupted/canceled (expected behavior)');
            resolve();
            return;
          }
          
          const error = new Error(`TTS error: ${event.error}`);
          if (callbacks.onError) callbacks.onError(error);
          reject(error);
        };
        
        // Speak the text
        try {
          console.log('[TTS speakNow] Calling speechSynthesis.speak()');
          
          // Force resume in case synthesis is suspended (Chrome mobile bug workaround)
          if (this.synthesis.paused) {
            console.log('[TTS speakNow] Synthesis was paused, resuming first');
            this.synthesis.resume();
          }
          
          this.synthesis.speak(this.currentUtterance);
          console.log('[TTS speakNow] speechSynthesis.speak() called successfully');
          
          // Additional safety check - ensure speech actually starts
          setTimeout(() => {
            if (this.currentUtterance && this.synthesis.paused) {
              console.log('[TTS speakNow] Speech stuck in paused state, forcing resume');
              this.synthesis.resume();
            }
            if (this.currentUtterance && !this.synthesis.speaking && !this.synthesis.pending) {
              console.warn('[TTS speakNow] Speech did not start - synthesis may be broken');
            }
          }, 200);
          
        } catch (error) {
          console.error('[TTS speakNow] Exception while calling speak():', error);
          this.currentUtterance = null;
          if (callbacks.onError) callbacks.onError(error);
          reject(error);
        }
      };
      
      // Resume speech synthesis if it's paused/suspended (Chrome bug fix)
      if (this.synthesis.paused) {
        console.log('[TTS speakNow] Synthesis is paused, resuming before continuing');
        this.synthesis.resume();
      }
      
      // Stop any ongoing speech
      if (this.synthesis.speaking) {
        console.log('[TTS speakNow] Canceling previous speech');
        this.synthesis.cancel();
        // Wait for cancellation to complete
        setTimeout(() => continueSpeaking(), 150);
      } else {
        console.log('[TTS speakNow] No previous speech, starting immediately');
        continueSpeaking();
      }
    });
  }
  
  /**
   * Stop any ongoing speech
   */
  stop() {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }
    this.currentUtterance = null;
  }
  
  /**
   * Pause ongoing speech
   */
  pause() {
    if (this.synthesis.speaking && !this.synthesis.paused) {
      this.synthesis.pause();
    }
  }
  
  /**
   * Resume paused speech
   */
  resume() {
    if (this.synthesis.paused) {
      this.synthesis.resume();
    }
  }
  
  /**
   * Check if currently speaking
   * @returns {boolean} True if speaking
   */
  isSpeaking() {
    return this.synthesis.speaking;
  }
  
  /**
   * Check if currently paused
   * @returns {boolean} True if paused
   */
  isPaused() {
    return this.synthesis.paused;
  }
  
  /**
   * Clean text for speech (remove markdown, HTML, etc.)
   * @param {string} text - The text to clean
   * @returns {string} Cleaned text
   */
  cleanText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    let cleaned = text;
    
    // Remove HTML tags
    cleaned = cleaned.replace(/<[^>]*>/g, ' ');
    
    // Remove markdown links [text](url) -> text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    
    // Remove markdown bold/italic **text** or *text* -> text
    cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1');
    
    // Remove markdown code blocks ```code``` -> code
    cleaned = cleaned.replace(/```[^`]*```/g, '');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    
    // Remove markdown headers # -> empty
    cleaned = cleaned.replace(/^#+\s*/gm, '');
    
    // Replace multiple spaces/newlines with single space
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    // Decode HTML entities
    cleaned = this.decodeHTMLEntities(cleaned);
    
    return cleaned.trim();
  }
  
  /**
   * Decode HTML entities
   * @param {string} text - Text with HTML entities
   * @returns {string} Decoded text
   */
  decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }
}

// Export as ES6 module
export { TextToSpeechService };
