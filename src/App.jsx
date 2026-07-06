import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, Play, Pause, Save, FolderOpen, Settings, Plus, Trash2, 
  Type, Move, ZoomIn, ZoomOut, Download, Sparkles, Clock, Sliders, X, Check, Globe, Video
} from 'lucide-react';
import { extractAudio } from './utils/audioExtractor';
import { transcribeAudio } from './services/groqService';
import { saveProject, getProject, listProjects, deleteProject } from './services/firebase';
import './App.css';

export default function App() {
  // Global App States
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('groq_api_key') || '');
  const [customProxy, setCustomProxy] = useState(() => localStorage.getItem('groq_cors_proxy') || 'https://corsproxy.io/?');
  const [disableProxy, setDisableProxy] = useState(() => {
    const saved = localStorage.getItem('groq_disable_proxy');
    return saved !== null ? saved === 'true' : true; // Default to true (bypassing CORS proxy)
  });
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('groq_model') || 'whisper-large-v3');
  const [selectedLanguage, setSelectedLanguage] = useState(() => localStorage.getItem('groq_language') || 'auto');

  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [savedProjects, setSavedProjects] = useState([]);
  
  // Media States
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Editor States
  const [captions, setCaptions] = useState([]);
  const [selectedCaptionId, setSelectedCaptionId] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState('tiktok');

  // Global caption position & scale (applies to ALL captions uniformly)
  const [captionX, setCaptionX] = useState(50);   // horizontal % (0-100)
  const [captionY, setCaptionY] = useState(82);   // vertical % (0-100)
  const [captionScale, setCaptionScale] = useState(0.6); // default smaller size
  const [captionWidth, setCaptionWidth] = useState(80); // default text box width percentage

  // Video Export States
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const isRecordingCancelledRef = useRef(false);

  // Mobile Tab State
  const [activeMobileTab, setActiveMobileTab] = useState('subtitles'); // subtitles, styles, timeline

  // Layout Options
  const [timelineZoom, setTimelineZoom] = useState(50); // pixels per second
  
  // Modal / UI state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Refs
  const videoRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const overlayContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync settings changes to localStorage
  useEffect(() => {
    localStorage.setItem('groq_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('groq_cors_proxy', customProxy);
  }, [customProxy]);

  useEffect(() => {
    localStorage.setItem('groq_disable_proxy', disableProxy.toString());
  }, [disableProxy]);

  useEffect(() => {
    localStorage.setItem('groq_model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('groq_language', selectedLanguage);
  }, [selectedLanguage]);

  // Load Saved Projects List
  const fetchProjects = async () => {
    try {
      const list = await listProjects();
      setSavedProjects(list);
    } catch (e) {
      console.error('Failed to load projects list:', e);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Update scrubber position as video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleDurationChange = () => {
      setVideoDuration(video.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl]);

  // Clean up object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Selected caption computed details
  const selectedCaption = useMemo(() => {
    return captions.find(c => c.id === selectedCaptionId) || null;
  }, [captions, selectedCaptionId]);

  // Captions active at current playback time
  const activeCaptions = useMemo(() => {
    return captions.filter(c => currentTime >= c.start && currentTime <= c.end);
  }, [captions, currentTime]);

  // Handle Play/Pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().catch(err => console.error("Error playing video:", err));
      setIsPlaying(true);
    }
  };

  // Video Upload Handlers
  const handleVideoUpload = async (file) => {
    if (!file) return;
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setIsPlaying(false);
    setCurrentTime(0);
    
    // Automatically generate clean project ID and name if empty
    if (!projectId) {
      const generatedId = `proj-${Date.now()}`;
      setProjectId(generatedId);
      setProjectName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  // Extract audio & Transcribe
  const handleGenerateCaptions = async () => {
    if (!videoFile) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const result = await extractAudio(videoFile, (msg) => {
        setLoadingMessage(msg);
      });
      
      setLoadingMessage('Sending audio to Groq Whisper for transcription...');
      
      const transcriptionOptions = {
        model: selectedModel,
        corsProxy: customProxy,
        disableProxy: disableProxy
      };

      if (selectedLanguage === 'en') {
        transcriptionOptions.language = 'en';
      } else if (selectedLanguage === 'hi') {
        transcriptionOptions.language = 'hi';
      } else if (selectedLanguage === 'hinglish') {
        transcriptionOptions.language = 'en'; // Force English vocabulary tokenization (Latin letters)
        transcriptionOptions.prompt = 'Transcribe this Hinglish audio (Hindi language spoken but written using English alphabets/Latin characters). Do not write Devanagari, do not write Urdu script, do not translate to English. Write verbatim Hinglish, e.g. "kaise ho?", "sab theek hai?", "aaj hum kaam karenge".';
      }

      const transcriptCaptions = await transcribeAudio(result.blob, apiKey, transcriptionOptions);
      
      setCaptions(transcriptCaptions);
      if (transcriptCaptions.length > 0) {
        setSelectedCaptionId(transcriptCaptions[0].id);
      }
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || 'An error occurred during transcription.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Download Extracted WAV for testing/debugging
  const handleDownloadWav = async () => {
    if (!videoFile) return;
    setIsLoading(true);
    setLoadingMessage('Extracting audio track for download...');
    try {
      const result = await extractAudio(videoFile, (msg) => {
        setLoadingMessage(msg);
      });
      
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectName || 'extracted-audio'}.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setErrorMsg(`Failed to extract and download WAV: ${error.message}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Drag and Reposition — moves ALL captions globally
  const handleCaptionDragStart = (e, captionId) => {
    e.preventDefault();
    setSelectedCaptionId(captionId);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = captionX;
    const initialY = captionY;

    const containerRect = overlayContainerRef.current.getBoundingClientRect();

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const deltaPctX = (deltaX / containerRect.width) * 100;
      const deltaPctY = (deltaY / containerRect.height) * 100;
      setCaptionX(parseFloat(Math.max(2, Math.min(98, initialX + deltaPctX)).toFixed(1)));
      setCaptionY(parseFloat(Math.max(2, Math.min(98, initialY + deltaPctY)).toFixed(1)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Width handle drag — resizes the global text box width (managing words per line)
  const handleCaptionWidthStart = (e, captionId) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedCaptionId(captionId);

    const startX = e.clientX;
    const initialWidth = captionWidth;
    const containerRect = overlayContainerRef.current.getBoundingClientRect();

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // Convert pixel delta to percentage of container, dividing by scale to account for zoom factor
      const deltaPct = ((deltaX / containerRect.width) * 100) / captionScale;
      
      // Symmetrical resize (multiplying by 2 because box is centered)
      let newWidth = initialWidth + (deltaPct * 2);
      
      // Allow width to expand up to the container visual limit based on scale (max 200%)
      const maxWidth = Math.min(200, 100 / captionScale);
      newWidth = Math.max(15, Math.min(maxWidth, newWidth));
      
      setCaptionWidth(parseFloat(newWidth.toFixed(1)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Scale handle drag — resizes the global font size scale factor
  const handleCaptionScaleStart = (e, captionId) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedCaptionId(captionId);

    const startX = e.clientX;
    const initialScale = captionScale;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // 150px cursor travel = +1.0 scale factor
      const newScale = parseFloat(Math.max(0.15, Math.min(3.0, initialScale + (deltaX / 150))).toFixed(2));
      setCaptionScale(newScale);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Drag and Shift Timing Blocks on the Timeline
  const handleTimelineDragStart = (e, captionId, dragType) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedCaptionId(captionId);
    
    const caption = captions.find(c => c.id === captionId);
    const startX = e.clientX;
    const initialStart = caption.start;
    const initialEnd = caption.end;
    const duration = initialEnd - initialStart;
    
    // Jump video position to caption start on click
    if (videoRef.current) {
      videoRef.current.currentTime = initialStart;
    }

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSeconds = deltaX / timelineZoom;
      
      if (dragType === 'move') {
        let newStart = initialStart + deltaSeconds;
        let newEnd = initialEnd + deltaSeconds;
        
        if (newStart < 0) {
          newStart = 0;
          newEnd = duration;
        }
        if (newEnd > videoDuration) {
          newEnd = videoDuration;
          newStart = videoDuration - duration;
        }
        
        setCaptions(prev => prev.map(c => 
          c.id === captionId ? { 
            ...c, 
            start: parseFloat(newStart.toFixed(2)), 
            end: parseFloat(newEnd.toFixed(2)) 
          } : c
        ).sort((a, b) => a.start - b.start));
      } else if (dragType === 'resize-left') {
        let newStart = Math.max(0, Math.min(initialEnd - 0.2, initialStart + deltaSeconds));
        setCaptions(prev => prev.map(c => 
          c.id === captionId ? { ...c, start: parseFloat(newStart.toFixed(2)) } : c
        ).sort((a, b) => a.start - b.start));
      } else if (dragType === 'resize-right') {
        let newEnd = Math.max(initialStart + 0.2, Math.min(videoDuration, initialEnd + deltaSeconds));
        setCaptions(prev => prev.map(c => 
          c.id === captionId ? { ...c, end: parseFloat(newEnd.toFixed(2)) } : c
        ).sort((a, b) => a.start - b.start));
      }
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Timeline Ruler Scrubber navigation click
  const handleRulerClick = (e) => {
    if (!videoDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedTime = clickX / timelineZoom;
    
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoDuration, clickedTime));
    }
  };

  // Add caption segment manually
  const handleAddCaption = () => {
    const newStart = parseFloat(currentTime.toFixed(2));
    const newEnd = parseFloat(Math.min(videoDuration, currentTime + 2.0).toFixed(2));
    const newCaption = {
      id: `cap-${Date.now()}`,
      start: newStart,
      end: newEnd,
      text: 'New subtitle text...',
      x: 50,
      y: 80,
      scale: 1
    };

    setCaptions(prev => [...prev, newCaption].sort((a, b) => a.start - b.start));
    setSelectedCaptionId(newCaption.id);
  };

  // Delete caption segment
  const handleDeleteCaption = (id) => {
    setCaptions(prev => prev.filter(c => c.id !== id));
    if (selectedCaptionId === id) {
      setSelectedCaptionId(null);
    }
  };

  // Update caption text
  const handleUpdateCaptionText = (id, newText) => {
    setCaptions(prev => prev.map(c => 
      c.id === id ? { ...c, text: newText } : c
    ));
  };

  // Update timing fields manually in panel
  const handleUpdateTiming = (id, field, value) => {
    let numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    setCaptions(prev => prev.map(c => {
      if (c.id === id) {
        if (field === 'start') {
          // Clamp start between 0 and end - 0.1
          const startClamped = Math.max(0, Math.min(c.end - 0.1, numVal));
          return { ...c, start: parseFloat(startClamped.toFixed(2)) };
        } else {
          // Clamp end between start + 0.1 and video duration
          const endClamped = Math.max(c.start + 0.1, Math.min(videoDuration || 9999, numVal));
          return { ...c, end: parseFloat(endClamped.toFixed(2)) };
        }
      }
      return c;
    }).sort((a, b) => a.start - b.start));
  };

  // Save Project to Firebase Realtime Database
  const handleSaveToFirebase = async () => {
    if (!projectName.trim()) return;
    setIsLoading(true);
    try {
      const projectData = {
        name: projectName,
        captions: captions,
        preset: selectedPreset,
        captionX, captionY, captionScale, captionWidth,
        videoFileName: videoFile ? videoFile.name : 'Unknown Video'
      };
      await saveProject(projectId, projectData);
      setShowSaveModal(false);
      fetchProjects();
    } catch (e) {
      console.error(e);
      setErrorMsg(`Firebase Save Failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Load Project metadata from Firebase
  const handleLoadProject = async (proj) => {
    setIsLoading(true);
    setShowLoadModal(false);
    try {
      const data = await getProject(proj.id);
      if (data) {
        setProjectId(proj.id);
        setProjectName(data.name);
        setCaptions(data.captions || []);
        setSelectedPreset(data.preset || 'tiktok');
        if (data.captionX !== undefined) setCaptionX(data.captionX);
        if (data.captionY !== undefined) setCaptionY(data.captionY);
        if (data.captionScale !== undefined) setCaptionScale(data.captionScale);
        if (data.captionWidth !== undefined) setCaptionWidth(data.captionWidth);
        
        // Wipe video file if it's different. Instruct user to upload the video asset
        setVideoFile(null);
        setVideoUrl('');
        setErrorMsg(`Project loaded! Please upload/drag the original video file "${data.videoFileName}" to edit.`);
      }
    } catch (e) {
      console.error(e);
      setErrorMsg(`Firebase Load Failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete project from database list
  const handleDeleteProject = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await deleteProject(id);
      fetchProjects();
    } catch (error) {
      console.error(error);
    }
  };

  // Helper for word wrapping of tokens on the export canvas
  const wrapWordTokens = (ctx, words, maxWidth) => {
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const spaceWidth = currentLine.length > 0 ? ctx.measureText(' ').width : 0;
      const wordWidth = ctx.measureText(word).width;
      
      if (currentWidth + spaceWidth + wordWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [word];
        currentWidth = wordWidth;
      } else {
        currentLine.push(word);
        currentWidth += spaceWidth + wordWidth;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines;
  };

  // Canvas captions drawing engine
  const drawCaptionsOnExportCanvas = (ctx, time, width, height, wrapCache = {}) => {
    const active = captions.filter(cap => time >= cap.start && time <= cap.end);
    if (active.length === 0) return;

    const clientWidth = videoRef.current ? videoRef.current.clientWidth : 640;
    const ratio = width / clientWidth;
    const scale = captionScale * ratio;

    active.forEach(cap => {
      const words = cap.text.split(/\s+/);
      const duration = cap.end - cap.start;
      const elapsed = time - cap.start;
      const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
      const activeWordIdx = Math.floor(progress * words.length);

      const posX = (captionX / 100) * width;
      const posY = (captionY / 100) * height;
      
      // Match the text box wrapping boundaries exactly by applying the scale factor to the width
      const boxWidth = (captionWidth / 100) * width * captionScale;

      let fontStr = '';
      let baseFontSize = 20;
      let activeColor = '';
      let inactiveColor = '';
      let outlineColor = '';
      let outlineWidth = 0;
      let shadowColor = '';
      let shadowBlur = 0;
      let isGradient = false;
      let drawBgBox = false;
      let isTypewriter = false;
      let isGlitch = false;

      switch (selectedPreset) {
        case 'tiktok':
          baseFontSize = 20;
          fontStr = `900 ${baseFontSize * scale}px Outfit, Impact, sans-serif`;
          inactiveColor = '#fffb00';
          activeColor = '#ffffff';
          outlineColor = '#000000';
          outlineWidth = 4.5 * scale;
          break;
        case 'netflix':
          baseFontSize = 16;
          fontStr = `500 ${baseFontSize * scale}px Arial, Helvetica, sans-serif`;
          inactiveColor = '#ffffff';
          activeColor = '#e5c07b';
          drawBgBox = true;
          break;
        case 'neon':
          baseFontSize = 18;
          fontStr = `italic 800 ${baseFontSize * scale}px Outfit, sans-serif`;
          inactiveColor = '#e9d5ff';
          activeColor = '#ffffff';
          shadowColor = '#8b5cf6';
          shadowBlur = 10 * scale;
          break;
        case 'minimal':
          baseFontSize = 13;
          fontStr = `300 ${baseFontSize * scale}px Inter, sans-serif`;
          inactiveColor = 'rgba(255, 255, 255, 0.92)';
          activeColor = '#ffffff';
          break;
        case 'fire':
          baseFontSize = 22;
          fontStr = `900 ${baseFontSize * scale}px Outfit, Impact, sans-serif`;
          isGradient = true;
          outlineColor = '#000000';
          outlineWidth = 1.2 * scale;
          break;
        case 'typewriter':
          baseFontSize = 15;
          fontStr = `700 ${baseFontSize * scale}px "Courier New", Courier, monospace`;
          inactiveColor = '#4ade80';
          activeColor = '#bbf7d0';
          isTypewriter = true;
          drawBgBox = true;
          break;
        case 'cinema':
          baseFontSize = 16;
          fontStr = `italic 400 ${baseFontSize * scale}px Georgia, serif`;
          inactiveColor = '#e2e8f0';
          activeColor = '#ffffff';
          shadowColor = 'rgba(0,0,0,0.85)';
          shadowBlur = 8 * scale;
          break;
        case 'glitch':
          baseFontSize = 20;
          fontStr = `900 ${baseFontSize * scale}px Outfit, Impact, monospace`;
          inactiveColor = '#00ffcc';
          activeColor = '#ffffff';
          isGlitch = true;
          break;
      }

      ctx.save();
      ctx.font = fontStr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Use caching to prevent heavy measureText calculations on every single frame!
      const cacheKey = `${cap.id}_${boxWidth.toFixed(1)}_${fontStr}`;
      if (!wrapCache[cacheKey]) {
        wrapCache[cacheKey] = wrapWordTokens(ctx, words, boxWidth);
      }
      const linesOfWords = wrapCache[cacheKey];
      
      // Calculate layout line spacing and box height proportionally
      const fontSize = baseFontSize * scale;
      const lineHeights = fontSize * 1.38;
      const totalHeight = linesOfWords.length * lineHeights;
      let currentY = posY - (totalHeight / 2) + (lineHeights / 2);

      if (drawBgBox) {
        ctx.fillStyle = selectedPreset === 'typewriter' ? 'rgba(0, 0, 0, 0.88)' : 'rgba(0, 0, 0, 0.82)';
        let maxLineWidth = 0;
        linesOfWords.forEach(lineWords => {
          const w = ctx.measureText(lineWords.join(' ')).width;
          if (w > maxLineWidth) maxLineWidth = w;
        });

        // Match the background box padding from CSS
        const paddingX = (selectedPreset === 'typewriter' ? 14 : 16) * scale;
        const paddingY = (selectedPreset === 'typewriter' ? 8 : 6) * scale;
        const bgWidth = maxLineWidth + paddingX * 2;
        const bgHeight = totalHeight + paddingY * 2;
        const bgLeft = posX - bgWidth / 2;
        const bgTop = posY - bgHeight / 2;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bgLeft, bgTop, bgWidth, bgHeight, 5 * scale);
        } else {
          ctx.rect(bgLeft, bgTop, bgWidth, bgHeight);
        }
        ctx.fill();
      }

      let globalWordIdx = 0;

      linesOfWords.forEach((lineWords, lineIdx) => {
        const lineText = lineWords.join(' ');
        const lineWidth = ctx.measureText(lineText).width;
        let startX = posX - (lineWidth / 2);

        lineWords.forEach((word) => {
          const isActive = globalWordIdx === activeWordIdx;
          const isPast = globalWordIdx < activeWordIdx;
          const wordWidth = ctx.measureText(word).width;
          const spaceWidth = ctx.measureText(' ').width;
          const wordCenterX = startX + wordWidth / 2;

          if (isTypewriter && !isPast && !isActive) {
            globalWordIdx++;
            startX += wordWidth + spaceWidth;
            return;
          }

          ctx.save();
          if (shadowColor) {
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = shadowBlur;
          }

          if (isGradient) {
            const grad = ctx.createLinearGradient(0, currentY - 15 * scale, 0, currentY + 15 * scale);
            if (isActive) {
              grad.addColorStop(0, '#ffffff');
              grad.addColorStop(1, '#ffeb3b');
              ctx.shadowColor = 'rgba(255, 235, 59, 0.7)';
              ctx.shadowBlur = 10 * scale;
            } else {
              grad.addColorStop(0, '#fff700');
              grad.addColorStop(0.5, '#ff8c00');
              grad.addColorStop(1, '#ff2200');
            }
            ctx.fillStyle = grad;
          } else {
            ctx.fillStyle = isActive ? activeColor : inactiveColor;
          }

          if (isPast && !isTypewriter) {
            ctx.globalAlpha = 0.55;
          }

          if (outlineColor && outlineWidth > 0) {
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = outlineWidth;
            ctx.lineJoin = 'round';
            ctx.strokeText(word, wordCenterX, currentY);
          }

          if (isGlitch) {
            if (isActive) {
              ctx.fillStyle = '#ff0050';
              ctx.fillText(word, wordCenterX + 3 * scale, currentY);
              ctx.fillStyle = '#004dff';
              ctx.fillText(word, wordCenterX - 3 * scale, currentY);
              ctx.fillStyle = '#ffffff';
            } else {
              ctx.fillStyle = 'rgba(0, 255, 204, 0.5)';
              ctx.fillText(word, wordCenterX - 1.5 * scale, currentY);
              ctx.fillStyle = '#00ffcc';
            }
          }

          ctx.fillText(word, wordCenterX, currentY);

          if (isTypewriter && isActive) {
            ctx.fillStyle = '#4ade80';
            const blink = Math.floor(time * 5) % 2 === 0;
            if (blink) {
              ctx.fillRect(startX + wordWidth + 2 * scale, currentY - 8 * scale, 3 * scale, 16 * scale);
            }
          }

          ctx.restore();
          globalWordIdx++;
          startX += wordWidth + spaceWidth;
        });

        currentY += lineHeights;
      });

      ctx.restore();
    });
  };

  // Cancel video export
  const cancelExport = () => {
    isRecordingCancelledRef.current = true;
    setIsExporting(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.muted = false;
      videoRef.current.currentTime = 0;
    }
  };

  // Video Export recorder trigger
  const handleExportVideo = async () => {
    const video = videoRef.current;
    if (!video || !videoFile) {
      setErrorMsg('No video file loaded to export.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    isRecordingCancelledRef.current = false;
    setIsPlaying(false);
    video.pause();

    // Cache wrapped text layout lines to avoid recalculating sizes 30 times a second
    const textWrapCache = {};

    const originalMuted = video.muted;
    const originalCurrentTime = video.currentTime;
    const originalLoop = video.loop;

    video.muted = true;
    video.loop = false;
    video.currentTime = 0;

    // Restrict maximum export resolution to 1080p (Full HD) to prevent browser memory choke and export lag
    let exportWidth = video.videoWidth;
    let exportHeight = video.videoHeight;
    const MAX_WIDTH = 1920;
    const MAX_HEIGHT = 1080;

    if (exportWidth > MAX_WIDTH || exportHeight > MAX_HEIGHT) {
      const ratioX = MAX_WIDTH / exportWidth;
      const ratioY = MAX_HEIGHT / exportHeight;
      const scaleFactor = Math.min(ratioX, ratioY);
      exportWidth = Math.round(exportWidth * scaleFactor);
      exportHeight = Math.round(exportHeight * scaleFactor);
      console.log(`Scaling down export resolution from ${video.videoWidth}x${video.videoHeight} to ${exportWidth}x${exportHeight} for performance.`);
    }

    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = exportHeight;
    const ctx = canvas.getContext('2d');

    const videoStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    const audioTrack = videoStream.getAudioTracks()[0];
    const canvasStream = canvas.captureStream(30); // 30 FPS stream

    const outputStream = new MediaStream();
    outputStream.addTrack(canvasStream.getVideoTracks()[0]);
    if (audioTrack) {
      outputStream.addTrack(audioTrack);
    }

    // Try H264 MP4 first for maximum cross-platform compatibility, falling back to WebM
    let options = { mimeType: 'video/mp4;codecs=h264', videoBitsPerSecond: 8000000 };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/mp4', videoBitsPerSecond: 8000000 };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm', videoBitsPerSecond: 6000000 };
    }

    const recordedChunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(outputStream, options);
    } catch (e) {
      console.warn("Failed to initialize MediaRecorder with high bitrate, falling back to defaults:", e);
      recorder = new MediaRecorder(outputStream);
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      video.muted = originalMuted;
      video.currentTime = originalCurrentTime;
      video.loop = originalLoop;
      setIsExporting(false);

      if (isRecordingCancelledRef.current) return;

      const blob = new Blob(recordedChunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const fileExt = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${projectName || 'captioned-video'}-export.${fileExt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const renderExportFrame = () => {
      // Check if video has ended or reached within 0.1s of the end (avoids browser decoders getting stuck at 99%)
      const hasEnded = video.ended || video.currentTime >= video.duration - 0.1;

      if (isRecordingCancelledRef.current || hasEnded) {
        setExportProgress(100);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawCaptionsOnExportCanvas(ctx, video.currentTime, canvas.width, canvas.height, textWrapCache);

      const progress = Math.min(100, Math.floor((video.currentTime / video.duration) * 100));
      setExportProgress(progress);

      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(renderExportFrame);
      } else {
        requestAnimationFrame(renderExportFrame);
      }
    };

    const startRecording = () => {
      video.removeEventListener('seeked', startRecording);
      recorder.start();
      video.play();
      
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(renderExportFrame);
      } else {
        requestAnimationFrame(renderExportFrame);
      }
    };

    video.addEventListener('seeked', startRecording);
    setTimeout(() => {
      if (recorder.state === 'inactive' && !isRecordingCancelledRef.current) {
        startRecording();
      }
    }, 150);
  };

  // Export SRT
  const exportSRT = () => {
    let srtText = '';
    
    captions.forEach((cap, index) => {
      const formatTime = (timeInSecs) => {
        const date = new Date(0);
        date.setSeconds(timeInSecs);
        // Extract milliseconds
        const ms = Math.floor((timeInSecs % 1) * 1000).toString().padStart(3, '0');
        const timeString = date.toISOString().substr(11, 8);
        return `${timeString},${ms}`;
      };

      srtText += `${index + 1}\n`;
      srtText += `${formatTime(cap.start)} --> ${formatTime(cap.end)}\n`;
      srtText += `${cap.text}\n\n`;
    });

    const blob = new Blob([srtText], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName || 'subtitles'}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export JSON
  const exportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(captions, null, 2));
    const link = document.createElement('a');
    link.href = dataStr;
    link.download = `${projectName || 'subtitles'}.json`;
    link.click();
  };

  // Exit editor and return to home page
  const handleExitProject = () => {
    if (confirm("Are you sure you want to exit? Ensure you have saved your project!")) {
      setProjectId('');
      setProjectName('');
      setVideoFile(null);
      setVideoUrl('');
      setCaptions([]);
      setSelectedCaptionId(null);
    }
  };

  // Render word-by-word highlighted text for karaoke-style presets
  const renderKaraokeText = (text, start, end) => {
    const words = text.split(/\s+/);
    const duration = end - start;
    const elapsed = currentTime - start;
    const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
    const activeWordIndex = Math.floor(progress * words.length);

    return (
      <>
        {words.map((word, idx) => {
          const isActive = idx === activeWordIndex;
          const isPast = idx < activeWordIndex;
          return (
            <span
              key={idx}
              className={`word-token ${isActive ? 'word-active' : ''} ${isPast ? 'word-past' : ''}`}
            >
              {word}
            </span>
          );
        })}
      </>
    );
  };

  // Main UI render
  return (
    <div className="app-container">
      {/* GLOBAL NAVBAR */}
      <nav className="navbar">
        <div className="logo">
          <Sparkles className="logo-sparkle animate-pulse" />
          <span>CAPTIONLY</span>
        </div>

        {projectId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Project: <strong style={{ color: '#fff' }}>{projectName}</strong>
            </span>
            <button className="btn btn-secondary" onClick={() => setShowSaveModal(true)}>
              <Save size={16} /> Save Project
            </button>
            
            <div style={{ display: 'flex', border: '1px solid var(--border-light)', borderRadius: '8px', overflow: 'hidden' }}>
              <button 
                className="btn btn-secondary" 
                style={{ borderRadius: '0', border: 'none', borderRight: '1px solid var(--border-light)' }} 
                onClick={exportSRT}
              >
                <Download size={16} /> Export SRT
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ borderRadius: '0', border: 'none' }} 
                onClick={exportJSON}
              >
                JSON
              </button>
            </div>

            <button 
              className="btn btn-primary animate-pulse" 
              style={{ background: 'linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)', border: 'none', boxShadow: '0 0 14px rgba(139, 92, 246, 0.3)' }}
              onClick={handleExportVideo}
              disabled={!videoFile || captions.length === 0}
              title={!videoFile ? "Please load a video first" : "Burn captions into video and export"}
            >
              <Video size={16} /> Export Video
            </button>

            <button className="btn btn-secondary" onClick={() => setShowSettingsModal(true)}>
              <Settings size={16} /> Settings
            </button>

            <button className="btn btn-danger" onClick={handleExitProject}>
              Exit
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setShowSettingsModal(true)}>
            <Settings size={16} /> API Setup
          </button>
        )}
      </nav>

      {/* ERROR / NOTIFICATION MESSAGE BANNER */}
      {errorMsg && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.15)', 
          borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#fca5a5', 
          padding: '12px 24px', 
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{errorMsg}</span>
          <X size={16} style={{ cursor: 'pointer' }} onClick={() => setErrorMsg('')} />
        </div>
      )}

      {/* LOADING OVERLAY SCREEN */}
      {isLoading && (
        <div className="dialog-overlay">
          <div className="glass-panel dialog-content" style={{ textAlign: 'center', padding: '40px' }}>
            <div className="spinner" style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(139, 92, 246, 0.2)',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
              margin: '0 auto 20px',
              animation: 'spin 1s linear infinite'
            }}></div>
            <h3 style={{ marginBottom: '10px' }}>Please Wait</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{loadingMessage || 'Processing data...'}</p>
          </div>
          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}

      {/* SETUP / HOME SCREEN */}
      {!projectId ? (
        <div className="welcome-container">
          <h1 className="welcome-title">AI Video Captioning, Styled</h1>
          <p className="welcome-subtitle">
            Generate stunning subtitle templates, reposition text directly on-screen, and tweak your transcription timing down to the millisecond—all 100% on the browser.
          </p>

          <div className="glass-panel config-card">
            <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={22} color="var(--primary)" /> 1. Start a New Project
            </h2>
            
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Project Name</label>
              <input 
                type="text" 
                className="input-text" 
                placeholder="Enter project name..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            <div 
              className="upload-area"
              onClick={() => fileInputRef.current.click()}
            >
              <Upload size={48} className="upload-icon animate-pulse" />
              <div>
                <p style={{ fontWeight: 600, marginBottom: '6px' }}>Select or Drag Video File</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Supports MP4, WebM, MOV</p>
              </div>
              <input 
                ref={fileInputRef}
                type="file" 
                accept="video/*" 
                style={{ display: 'none' }} 
                onChange={(e) => {
                  if (e.target.files[0]) {
                    handleVideoUpload(e.target.files[0]);
                  }
                }}
              />
            </div>
          </div>

          {/* Load Firebase projects database */}
          <div className="glass-panel config-card">
            <h2 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderOpen size={22} color="var(--accent)" /> 2. Load Saved Cloud Project
            </h2>
            {savedProjects.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No projects saved in Firebase database yet.</p>
            ) : (
              <div className="project-list">
                {savedProjects.map(proj => (
                  <div 
                    key={proj.id} 
                    className="project-item-card"
                    onClick={() => handleLoadProject(proj)}
                  >
                    <div className="project-item-details">
                      <span className="project-item-title">{proj.name}</span>
                      <span className="project-item-date">
                        Last saved: {new Date(proj.updatedAt).toLocaleString()} • {proj.captions?.length || 0} subtitles
                      </span>
                    </div>
                    <button 
                      className="btn btn-danger" 
                      style={{ padding: '6px' }}
                      onClick={(e) => handleDeleteProject(e, proj.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* MAIN WORKSPACE VIEW */
        <div className={`workspace-grid active-tab-${activeMobileTab}`}>
          
          {/* SIDEBAR LEFT: EDITOR TRANSCRIPT */}
          <aside className="sidebar">
            <div className="sidebar-header">
              <h3 className="sidebar-title">
                <Clock size={16} /> Subtitles Timeline
              </h3>
              <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={handleAddCaption}>
                <Plus size={14} /> Add
              </button>
            </div>
            
            <div className="sidebar-content">
              {captions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
                  <Type size={36} style={{ marginBottom: '12px', opacity: 0.3 }} />
                  <p style={{ fontSize: '0.9rem', marginBottom: '16px' }}>No captions generated yet.</p>
                  
                  <div className="form-group" style={{ marginBottom: '20px', textAlign: 'left' }}>
                    <label className="form-label">Audio Language</label>
                    <select 
                      className="input-text"
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      style={{ width: '100%', background: 'rgba(17, 24, 39, 0.8)', color: '#fff' }}
                    >
                      <option value="auto">Auto-Detect Language</option>
                      <option value="en">English (en)</option>
                      <option value="hi">Hindi (हिन्दी - hi)</option>
                      <option value="hinglish">Hinglish (Hindi in English Script)</option>
                    </select>
                  </div>

                  <button 
                    className="btn btn-primary" 
                    onClick={handleGenerateCaptions}
                    disabled={!videoFile}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Auto-Generate with AI
                  </button>
                </div>
              ) : (
                <div className="caption-list">
                  {captions.map((cap) => (
                    <div 
                      key={cap.id} 
                      className={`caption-item-card ${selectedCaptionId === cap.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCaptionId(cap.id);
                        if (videoRef.current) {
                          videoRef.current.currentTime = cap.start;
                        }
                      }}
                    >
                      <div className="caption-card-time">
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input 
                            type="number" 
                            step="0.1"
                            value={cap.start}
                            onChange={(e) => handleUpdateTiming(cap.id, 'start', e.target.value)}
                            style={{ width: '54px', background: 'transparent', border: 'none', color: '#fff', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}
                          />
                          <span>→</span>
                          <input 
                            type="number" 
                            step="0.1"
                            value={cap.end}
                            onChange={(e) => handleUpdateTiming(cap.id, 'end', e.target.value)}
                            style={{ width: '54px', background: 'transparent', border: 'none', color: '#fff', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}
                          />
                        </div>
                        <button 
                          className="btn btn-danger" 
                          style={{ padding: '2px', background: 'transparent', border: 'none' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCaption(cap.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      
                      <textarea
                        className="caption-card-input"
                        value={cap.text}
                        rows={2}
                        onChange={(e) => handleUpdateCaptionText(cap.id, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* CENTER: VIDEO PREVIEW CONTAINER */}
          <main className="video-player-container">
            {videoUrl ? (
              <div className="video-wrapper">
                <video 
                  ref={videoRef}
                  src={videoUrl}
                  className="main-video"
                  onClick={togglePlay}
                />
                
                {/* Visual Subtitle Canvas overlay — ALL captions share ONE global position */}
                <div ref={overlayContainerRef} className="captions-overlay-container">
                  {activeCaptions.map((cap, idx) => {
                    const presetClass = `caption-style-${selectedPreset}`;
                    const isSelected = selectedCaptionId === cap.id;
                    const customStyle = {
                      left: `${captionX}%`,
                      top: `${captionY}%`,
                      width: `${captionWidth}%`,
                      transform: `translate(-50%, -50%) scale(${captionScale})`,
                    };

                    return (
                      <div
                        key={cap.id}
                        className={`caption-overlay-item ${presetClass} ${isSelected ? 'cap-selected' : ''}`}
                        style={customStyle}
                        onMouseDown={(e) => handleCaptionDragStart(e, cap.id)}
                      >
                        {renderKaraokeText(cap.text, cap.start, cap.end)}

                        {/* Sizing handles — visible only when selected to prevent overlay clutter */}
                        {isSelected && (
                          <>
                            {/* Width Resize handle (pills on the right edge) */}
                            <div
                              className="caption-width-handle"
                              onMouseDown={(e) => handleCaptionWidthStart(e, cap.id)}
                              title="Drag side to change text wrapping width"
                            />
                            {/* Scale Resize handle (circle on the bottom-right corner) */}
                            <div
                              className="caption-scale-handle"
                              onMouseDown={(e) => handleCaptionScaleStart(e, cap.id)}
                              title="Drag corner to change text font size (scale)"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '60px 40px', maxWidth: '500px', textAlign: 'center' }}>
                <Upload size={48} style={{ color: 'var(--primary)', marginBottom: '20px' }} />
                <h3 style={{ marginBottom: '12px' }}>Video Asset Required</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                  Please upload the matching video file to preview and edit subtitles.
                </p>
                <button className="btn btn-primary" onClick={() => fileInputRef.current.click()}>
                  <Upload size={16} /> Upload Video
                </button>
                <input 
                  ref={fileInputRef}
                  type="file" 
                  accept="video/*" 
                  style={{ display: 'none' }} 
                  onChange={(e) => {
                    if (e.target.files[0]) {
                      handleVideoUpload(e.target.files[0]);
                    }
                  }}
                />
              </div>
            )}

            {/* Video Controls bar */}
            {videoUrl && (
              <div className="custom-video-controls">
                <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={togglePlay}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                
                <span className="time-display">
                  {parseFloat(currentTime.toFixed(2))}s / {parseFloat(videoDuration.toFixed(2))}s
                </span>
                
                <div 
                  className="play-progress-bar"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const pct = clickX / rect.width;
                    if (videoRef.current) {
                      videoRef.current.currentTime = pct * videoDuration;
                    }
                  }}
                >
                  <div 
                    className="play-progress-fill" 
                    style={{ width: `${videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0}%` }}
                  />
                </div>

                {captions.length === 0 && videoFile && (
                  <button className="btn btn-primary" style={{ padding: '6px 12px' }} onClick={handleGenerateCaptions}>
                    <Sparkles size={14} /> Transcribe Video
                  </button>
                )}
              </div>
            )}
          </main>

          {/* SIDEBAR RIGHT: STYLES AND LAYOUT CONTROLS */}
          <aside className="sidebar sidebar-right">
            <div className="sidebar-header">
              <h3 className="sidebar-title">
                <Sliders size={16} /> Caption Styles
              </h3>
            </div>
            
            <div className="sidebar-content">
              <div className="form-group">
                <label className="form-label">Caption Style Templates</label>
                <div className="style-presets-grid">

                  <button className={`style-preset-btn ${selectedPreset === 'tiktok' ? 'active' : ''}`} onClick={() => setSelectedPreset('tiktok')}>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 900, fontSize: 13, color: '#fffb00', WebkitTextStroke: '1px #000', textTransform: 'uppercase' }}>REELS</span>
                    <span className="style-preset-name">⚡ TikTok Reels</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'netflix' ? 'active' : ''}`} onClick={() => setSelectedPreset('netflix')}>
                    <span style={{ fontFamily: 'Arial', fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.75)', padding: '2px 5px', borderRadius: 3 }}>Netflix</span>
                    <span className="style-preset-name">🎬 Netflix Box</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'neon' ? 'active' : ''}`} onClick={() => setSelectedPreset('neon')}>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: 12, color: '#fff', textShadow: '0 0 8px #a78bfa, 0 0 16px #7c3aed', fontStyle: 'italic' }}>Neon</span>
                    <span className="style-preset-name">✨ Neon Glow</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'minimal' ? 'active' : ''}`} onClick={() => setSelectedPreset('minimal')}>
                    <span style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 10, color: '#f3f4f6', letterSpacing: '0.15em' }}>MINIMAL</span>
                    <span className="style-preset-name">🤍 Minimal Clean</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'fire' ? 'active' : ''}`} onClick={() => setSelectedPreset('fire')}>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 900, fontSize: 13, background: 'linear-gradient(to bottom, #fff700, #ff6b00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>FIRE</span>
                    <span className="style-preset-name">🔥 Fire Gradient</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'typewriter' ? 'active' : ''}`} onClick={() => setSelectedPreset('typewriter')}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4ade80', background: 'rgba(0,0,0,0.85)', padding: '2px 6px', borderRadius: 3, borderLeft: '2px solid #4ade80' }}>type_</span>
                    <span className="style-preset-name">⌨️ Typewriter</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'cinema' ? 'active' : ''}`} onClick={() => setSelectedPreset('cinema')}>
                    <span style={{ fontFamily: 'Georgia', fontSize: 11, color: '#e2e8f0', fontStyle: 'italic', letterSpacing: '0.1em', textShadow: '1px 1px 6px rgba(0,0,0,0.9)' }}>Cinema</span>
                    <span className="style-preset-name">🎥 Cinema Fade</span>
                  </button>

                  <button className={`style-preset-btn ${selectedPreset === 'glitch' ? 'active' : ''}`} onClick={() => setSelectedPreset('glitch')}>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 900, fontSize: 12, color: '#00ffcc', textShadow: '2px 0 #ff0050, -2px 0 #00f' }}>GLITCH</span>
                    <span className="style-preset-name">💀 Glitch FX</span>
                  </button>

                </div>
              </div>

              {/* Global Position & Scale Sliders — affect ALL captions uniformly */}
              <div className="glass-panel" style={{ padding: '16px', marginTop: '10px' }}>
                <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Move size={14} /> Position & Size (Global)
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <span>Horizontal X</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{captionX}%</span>
                    </div>
                    <input
                      type="range"
                      min="2" max="98" step="1"
                      value={captionX}
                      onChange={(e) => setCaptionX(parseInt(e.target.value))}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <span>Vertical Y</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{captionY}%</span>
                    </div>
                    <input
                      type="range"
                      min="2" max="98" step="1"
                      value={captionY}
                      onChange={(e) => setCaptionY(parseInt(e.target.value))}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <span>Text Scale</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{captionScale}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.2" max="3.0" step="0.05"
                      value={captionScale}
                      onChange={(e) => setCaptionScale(parseFloat(e.target.value))}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <span>Box Width</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{captionWidth}%</span>
                    </div>
                    <input
                      type="range"
                      min="15" max="200" step="1"
                      value={captionWidth}
                      onChange={(e) => setCaptionWidth(parseInt(e.target.value))}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                    Drag any caption on the video to reposition. Drag the ● dot to resize.
                  </p>
                </div>
              </div>
            </div>
          </aside>

          {/* TIMELINE TIMING NAVIGATOR (BOTTOM) */}
          <footer className="timeline-panel">
            <div className="timeline-toolbar">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Timeline Tracks</span>
              
              <div className="timeline-zoom-controls">
                <ZoomOut size={14} style={{ color: 'var(--text-secondary)' }} />
                <input 
                  type="range" 
                  min="20" 
                  max="120" 
                  value={timelineZoom} 
                  onChange={(e) => setTimelineZoom(parseInt(e.target.value))}
                  style={{ width: '80px', accentColor: 'var(--primary)' }}
                />
                <ZoomIn size={14} style={{ color: 'var(--text-secondary)' }} />
              </div>
            </div>

            <div ref={timelineScrollRef} className="timeline-scroll-container">
              {/* Ruler & Track area */}
              <div 
                className="timeline-tracks-wrapper" 
                style={{ width: `${Math.max(100, (videoDuration || 30) * timelineZoom)}px` }}
              >
                {/* Time Ruler */}
                <div 
                  className="timeline-ruler"
                  onClick={handleRulerClick}
                >
                  {Array.from({ length: Math.ceil(videoDuration || 30) }).map((_, i) => (
                    <div 
                      key={i} 
                      className={`ruler-tick ${i % 5 === 0 ? 'major' : ''}`}
                      style={{ left: `${i * timelineZoom}px` }}
                    >
                      {i % 5 === 0 && (
                        <span className="ruler-time-label">{i}s</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Subtitle segments tracks */}
                <div className="timeline-track">
                  {captions.map((cap) => {
                    const blockLeft = cap.start * timelineZoom;
                    const blockWidth = (cap.end - cap.start) * timelineZoom;
                    const isSelected = selectedCaptionId === cap.id;

                    return (
                      <div
                        key={cap.id}
                        className={`timeline-caption-block ${isSelected ? 'selected' : ''}`}
                        style={{
                          left: `${blockLeft}px`,
                          width: `${blockWidth}px`,
                        }}
                        onMouseDown={(e) => handleTimelineDragStart(e, cap.id, 'move')}
                        title="Drag to shift time. Drag edges to resize timing."
                      >
                        {/* Left edge resize handle */}
                        <div 
                          className="block-handle-left"
                          onMouseDown={(e) => handleTimelineDragStart(e, cap.id, 'resize-left')}
                        />
                        
                        <span style={{ pointerEvents: 'none' }}>{cap.text}</span>
                        
                        {/* Right edge resize handle */}
                        <div 
                          className="block-handle-right"
                          onMouseDown={(e) => handleTimelineDragStart(e, cap.id, 'resize-right')}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Scrubber Playhead line */}
                <div 
                  className="timeline-scrubber"
                  style={{ left: `${currentTime * timelineZoom}px` }}
                >
                  <div className="scrubber-head" />
                </div>
              </div>
            </div>
          </footer>

          {/* Mobile Editor Navigation Tabs (visible only on mobile viewport) */}
          <div className="mobile-editor-tabs">
            <button 
              className={`mobile-tab-btn ${activeMobileTab === 'subtitles' ? 'active' : ''}`}
              onClick={() => setActiveMobileTab('subtitles')}
            >
              📝 Subtitles
            </button>
            <button 
              className={`mobile-tab-btn ${activeMobileTab === 'styles' ? 'active' : ''}`}
              onClick={() => setActiveMobileTab('styles')}
            >
              🎨 Styles & Size
            </button>
            <button 
              className={`mobile-tab-btn ${activeMobileTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveMobileTab('timeline')}
            >
              ⏳ Timeline
            </button>
          </div>

        </div>
      )}

      {/* SAVE PROJECT MODAL */}
      {showSaveModal && (
        <div className="dialog-overlay">
          <div className="glass-panel dialog-content">
            <h3 className="dialog-header">Save Project to Cloud Database</h3>
            
            <div className="form-group">
              <label className="form-label">Project Name</label>
              <input 
                type="text" 
                className="input-text" 
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name..."
              />
            </div>
            
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              This will upload the subtitle timelines, layouts, and styles to your Firebase Realtime Database.
            </p>

            <div className="dialog-footer">
              <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveToFirebase}>
                <Check size={16} /> Save Database
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS / API SETUP MODAL */}
      {showSettingsModal && (
        <div className="dialog-overlay">
          <div className="glass-panel dialog-content" style={{ maxWidth: '550px' }}>
            <div className="dialog-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Settings & Keys Configuration</h3>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowSettingsModal(false)} />
            </div>

            {/* Managed API Keys Info */}
            <div className="form-group" style={{ background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '12px', borderRadius: '8px' }}>
              <label className="form-label" style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                🔑 Managed API Keys (Active)
              </label>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Your Groq API keys are securely managed via environment variables (<code>VITE_GROQ_API_KEYS</code>) with automatic failover rotation. Manual configuration is disabled.
              </p>
            </div>

            {/* Whisper model select */}
            <div className="form-group">
              <label className="form-label">Whisper Model Selection</label>
              <select 
                className="input-text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ background: 'rgba(17, 24, 39, 0.8)', color: '#fff' }}
              >
                <option value="whisper-large-v3">whisper-large-v3 (Highly Accurate)</option>
                <option value="whisper-large-v3-turbo">whisper-large-v3-turbo (Extremely Fast)</option>
              </select>
            </div>

            {/* Language select */}
            <div className="form-group">
              <label className="form-label">Transcription Language</label>
              <select 
                className="input-text"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                style={{ background: 'rgba(17, 24, 39, 0.8)', color: '#fff' }}
              >
                <option value="auto">Auto-Detect Language</option>
                <option value="en">English (en)</option>
                <option value="hi">Hindi (हिन्दी - hi)</option>
                <option value="hinglish">Hinglish (Hindi in English Script)</option>
              </select>
            </div>

            {/* CORS Proxy settings */}
            <div className="form-group" style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <input 
                  type="checkbox" 
                  id="disable-proxy-chk" 
                  checked={disableProxy} 
                  onChange={(e) => setDisableProxy(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="disable-proxy-chk" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                  Bypass CORS Proxy (Disable)
                </label>
              </div>

              {!disableProxy && (
                <>
                  <label className="form-label">CORS Proxy Prepend URL</label>
                  <input 
                    type="text" 
                    className="input-text" 
                    value={customProxy}
                    onChange={(e) => setCustomProxy(e.target.value)}
                    placeholder="https://corsproxy.io/?"
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Used to route requests and avoid CORS errors in client-side requests. We use <code>https://corsproxy.io/?</code> by default.
                  </span>
                </>
              )}
            </div>

            {/* Debugging section */}
            <div className="form-group" style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
              <label className="form-label">Debugging / Audio Diagnostics</label>
              <button 
                className="btn btn-secondary" 
                onClick={handleDownloadWav}
                disabled={!videoFile}
                style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
              >
                <Download size={16} /> Download Extracted WAV (Check Audio Quality)
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Extract and download the exact mono WAV file sent to Groq. Use this to verify that the browser-side audio extraction sounds clear and is not distorted.
              </span>
            </div>

            <div className="dialog-footer">
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setShowSettingsModal(false);
                  setErrorMsg('');
                }}
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
      {/* EXPORT VIDEO PROGRESS MODAL */}
      {isExporting && (
        <div className="dialog-overlay" style={{ zIndex: 9999 }}>
          <div className="glass-panel dialog-content" style={{ maxWidth: '420px', textAlign: 'center', padding: '30px' }}>
            <h3 className="dialog-header" style={{ justifyContent: 'center', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Video size={20} className="animate-bounce" /> Exporting Captioned Video
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '16px 0', lineHeight: '1.4' }}>
              We are drawing your styled captions frame-by-frame at native video resolution for original quality. Please keep this tab active.
            </p>
            
            <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', height: '10px', width: '100%', overflow: 'hidden', margin: '20px 0 10px 0', border: '1px solid var(--border-light)' }}>
              <div 
                style={{ 
                  background: 'linear-gradient(to right, var(--primary), #3b82f6)', 
                  height: '100%', 
                  width: `${exportProgress}%`,
                  transition: 'width 0.1s ease',
                  boxShadow: '0 0 12px var(--primary)'
                }} 
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              <span>Export Progress</span>
              <strong style={{ color: '#fff' }}>{exportProgress}%</strong>
            </div>

            <button 
              className="btn btn-danger" 
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={cancelExport}
            >
              Cancel Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
