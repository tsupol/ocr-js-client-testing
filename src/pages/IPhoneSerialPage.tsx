import { useState, useRef, useCallback, useEffect } from 'react';
import Tesseract, { PSM, OEM } from 'tesseract.js';
import { Button, Select, LabeledCheckbox, useSnackbarContext, Modal } from 'tsp-form';
import { Camera, CameraOff, RotateCcw, Check, ImageIcon } from 'lucide-react';

// Detection state machine
type DetectionPhase = 'scanning' | 'detecting' | 'locking' | 'confirmed';
type ScreenType = 'serial' | 'imei' | 'none';

interface DetectionState {
  phase: DetectionPhase;
  currentScreen: ScreenType;
  confidence: number;
  serialCandidates: string[];
  imeiCandidates: string[];
  imei2Candidates: string[];
  confirmedSerial: string | null;
  confirmedImei: string | null;
  confirmedImei2: string | null;
  serialImage: string | null;
  imeiImage: string | null;
  frameCount: number;
}

// Patterns for Serial and IMEI
const SERIAL_PATTERN = /[A-Z0-9]{10,12}/g;
const IMEI_PATTERN = /\d{2}\s?\d{6}\s?\d{6}\s?\d|\d{15}/g;

// Camera options
const cameraOptions = [
  { value: 'environment', label: 'Back Camera' },
  { value: 'user', label: 'Front Camera' },
];

// Test image options
const testImageOptions = [
  { value: '', label: 'Live Camera' },
  { value: '/test-serial-imei/sample_serial.jpg', label: 'Sample Serial' },
  { value: '/test-serial-imei/sample_imei.jpg', label: 'Sample IMEI' },
];

// Clean and normalize IMEI (remove spaces)
function normalizeImei(imei: string): string {
  return imei.replace(/\s/g, '');
}

// Validate IMEI using Luhn checksum
function isValidImei(imei: string): boolean {
  const digits = normalizeImei(imei);
  if (digits.length !== 15 || !/^\d+$/.test(digits)) return false;

  // Luhn checksum validation
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = parseInt(digits[i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[14], 10);
}

// Format IMEI with spaces for display
function formatImei(imei: string): string {
  const digits = normalizeImei(imei);
  if (digits.length !== 15) return digits;
  return `${digits.slice(0, 2)} ${digits.slice(2, 8)} ${digits.slice(8, 14)} ${digits.slice(14)}`;
}

// Extract Serial Number from text
function extractSerialNumbers(text: string): string[] {
  const serials: string[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for "Serial" keyword in current or previous line
    const hasSerialLabel = /serial/i.test(line) || (i > 0 && /serial/i.test(lines[i - 1]));

    if (hasSerialLabel) {
      const matches = line.match(SERIAL_PATTERN);
      if (matches) {
        serials.push(...matches.filter(m => !isValidImei(m)));
      }
    }
  }

  // Fallback: look for any alphanumeric pattern that looks like a serial
  if (serials.length === 0) {
    const matches = text.match(SERIAL_PATTERN);
    if (matches) {
      // Filter out likely IMEIs (15 digits)
      serials.push(...matches.filter(m => !/^\d{15}$/.test(m)));
    }
  }

  return [...new Set(serials)];
}

// Extract IMEIs from text
function extractImeis(text: string): string[] {
  const imeis: string[] = [];
  const matches = text.match(IMEI_PATTERN);

  if (matches) {
    for (const match of matches) {
      const normalized = normalizeImei(match);
      if (normalized.length === 15) {
        imeis.push(normalized);
      }
    }
  }

  return [...new Set(imeis)];
}

// Get most frequent value from array
function getMostFrequent(arr: string[], minCount: number = 3): string | null {
  if (arr.length === 0) return null;

  const counts = new Map<string, number>();
  arr.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));

  let maxCount = 0;
  let mostFrequent: string | null = null;

  counts.forEach((count, value) => {
    if (count > maxCount && count >= minCount) {
      maxCount = count;
      mostFrequent = value;
    }
  });

  return mostFrequent;
}

// Calculate confidence based on candidate consistency
function calculateConfidence(candidates: string[]): number {
  if (candidates.length === 0) return 0;

  const counts = new Map<string, number>();
  candidates.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));

  const maxCount = Math.max(...counts.values());
  const consistency = maxCount / Math.max(candidates.length, 1);

  return Math.min(100, Math.round(consistency * 100 * (Math.min(candidates.length, 5) / 5)));
}

export function IPhoneSerialPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const testImageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);
  const detectLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<string>('environment');
  const [testImagePath, setTestImagePath] = useState<string>('');
  const [testImageLoaded, setTestImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [showLowResPreview, setShowLowResPreview] = useState(false);
  const { addSnackbar } = useSnackbarContext();
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Track what we've already notified about
  const notifiedRef = useRef<{ serial: boolean; imei: boolean; all: boolean }>({
    serial: false,
    imei: false,
    all: false,
  });

  const [detection, setDetection] = useState<DetectionState>({
    phase: 'scanning',
    currentScreen: 'none',
    confidence: 0,
    serialCandidates: [],
    imeiCandidates: [],
    imei2Candidates: [],
    confirmedSerial: null,
    confirmedImei: null,
    confirmedImei2: null,
    serialImage: null,
    imeiImage: null,
    frameCount: 0,
  });

  // Initialize worker
  useEffect(() => {
    const init = async () => {
      try {
        setStatus('Loading OCR engine...');

        const worker = await Tesseract.createWorker('eng', OEM.LSTM_ONLY);
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        });
        workerRef.current = worker;

        setStatus('Ready - Start camera or select test image');
      } catch (err) {
        setError(`Failed to init OCR: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    };
    init();

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Capture frame from video or test image
  const captureFrame = useCallback((lowRes: boolean = false): HTMLCanvasElement | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let sourceWidth = 0;
    let sourceHeight = 0;
    let source: HTMLVideoElement | HTMLImageElement | null = null;

    if (testImagePath && testImageRef.current && testImageLoaded) {
      source = testImageRef.current;
      sourceWidth = testImageRef.current.naturalWidth;
      sourceHeight = testImageRef.current.naturalHeight;
    } else if (videoRef.current && videoRef.current.readyState >= 2) {
      source = videoRef.current;
      sourceWidth = videoRef.current.videoWidth;
      sourceHeight = videoRef.current.videoHeight;
    }

    if (!source || sourceWidth === 0) return null;

    // For low-res detection, use fixed small size for speed
    // For full extraction, use moderate resolution (not full 1080p)
    if (lowRes) {
      // Fixed 320px width for fast detection
      const targetWidth = 320;
      const scale = targetWidth / sourceWidth;
      canvas.width = targetWidth;
      canvas.height = Math.round(sourceHeight * scale);
    } else {
      // 640px width for extraction - good balance of speed vs accuracy
      const targetWidth = 640;
      const scale = Math.min(1, targetWidth / sourceWidth);
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
    }

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [testImagePath, testImageLoaded]);

  // Phase 1: Fast detection at low resolution - detect which screen is visible
  const runFastDetection = useCallback(async (canvas: HTMLCanvasElement): Promise<{
    hasIOSScreen: boolean;
    screenType: 'serial' | 'imei' | 'none';
    rawText: string;
  }> => {
    const worker = workerRef.current;
    if (!worker) return { hasIOSScreen: false, screenType: 'none', rawText: '' };

    try {
      const imageData = canvas.toDataURL('image/jpeg', 0.5);
      const result = await worker.recognize(imageData);
      const text = result.data.text.toLowerCase();

      // Detect which screen we're looking at
      const hasSerialLabel = /serial\s*(number)?/i.test(text);
      const hasImeiLabel = /imei/i.test(text);

      let screenType: 'serial' | 'imei' | 'none' = 'none';

      if (hasImeiLabel && !hasSerialLabel) {
        screenType = 'imei';
      } else if (hasSerialLabel && !hasImeiLabel) {
        screenType = 'serial';
      } else if (hasSerialLabel || hasImeiLabel) {
        // If both visible, prioritize based on pattern presence
        const hasImeiPattern = IMEI_PATTERN.test(result.data.text);
        const hasSerialPattern = SERIAL_PATTERN.test(result.data.text);
        if (hasImeiPattern && !hasSerialPattern) {
          screenType = 'imei';
        } else if (hasSerialPattern && !hasImeiPattern) {
          screenType = 'serial';
        } else {
          // Default to whichever label appears first/more prominently
          screenType = text.indexOf('imei') < text.indexOf('serial') ? 'imei' : 'serial';
        }
      }

      const hasIOSScreen = screenType !== 'none';

      return { hasIOSScreen, screenType, rawText: result.data.text };
    } catch {
      return { hasIOSScreen: false, screenType: 'none', rawText: '' };
    }
  }, []);

  // Phase 2: Full resolution extraction - only extract the relevant field
  const runFullExtraction = useCallback(async (
    canvas: HTMLCanvasElement,
    screenType: 'serial' | 'imei'
  ): Promise<{
    serials: string[];
    imeis: string[];
  }> => {
    const worker = workerRef.current;
    if (!worker) return { serials: [], imeis: [] };

    try {
      // Use single block mode for better text recognition
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });

      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      const result = await worker.recognize(imageData);
      const text = result.data.text;

      // Reset to sparse text for next detection
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });

      // Only extract the relevant field based on screen type
      if (screenType === 'serial') {
        const serials = extractSerialNumbers(text);
        return { serials, imeis: [] };
      } else {
        const imeis = extractImeis(text);
        return { serials: [], imeis };
      }
    } catch {
      return { serials: [], imeis: [] };
    }
  }, []);

  // Main detection loop
  const runDetectionLoop = useCallback(async () => {
    const isActive = isCameraActive || (testImagePath && testImageLoaded);
    if (!isActive || isProcessingRef.current || detection.phase === 'confirmed') {
      if (detection.phase !== 'confirmed') {
        setTimeout(() => {
          detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
        }, 100);
      }
      return;
    }

    isProcessingRef.current = true;

    try {
      // Phase 1: Fast detection at low resolution
      const lowResCanvas = captureFrame(true);
      if (!lowResCanvas) {
        isProcessingRef.current = false;
        detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
        return;
      }

      const { hasIOSScreen, screenType } = await runFastDetection(lowResCanvas);

      if (!hasIOSScreen || screenType === 'none') {
        setStatus('Point camera at iPhone Settings > About screen...');
        setDetection(prev => ({
          ...prev,
          phase: 'scanning',
          currentScreen: 'none',
          confidence: 0,
        }));
        isProcessingRef.current = false;
        setTimeout(() => {
          detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
        }, 200);
        return;
      }

      // Phase 2: Full resolution extraction - only for the detected screen type
      const screenLabel = screenType === 'serial' ? 'Serial Number' : 'IMEI';
      setStatus(`${screenLabel} screen detected - extracting...`);
      setDetection(prev => ({ ...prev, phase: 'detecting', currentScreen: screenType }));

      const fullResCanvas = captureFrame(false);
      if (!fullResCanvas) {
        isProcessingRef.current = false;
        detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
        return;
      }

      const { serials, imeis } = await runFullExtraction(fullResCanvas, screenType);

      // Capture current frame as image data URL for potential storage
      const currentFrameImage = fullResCanvas.toDataURL('image/jpeg', 0.8);

      // Update candidates - only for the current screen type
      setDetection(prev => {
        const newSerialCandidates = screenType === 'serial'
          ? [...prev.serialCandidates, ...serials].slice(-20)
          : prev.serialCandidates;
        const newImeiCandidates = screenType === 'imei'
          ? [...prev.imeiCandidates, ...imeis.slice(0, 1)].slice(-20)
          : prev.imeiCandidates;
        const newImei2Candidates = screenType === 'imei' && imeis.length > 1
          ? [...prev.imei2Candidates, imeis[1]].slice(-20)
          : prev.imei2Candidates;

        // Calculate confidence for current screen type
        const currentConfidence = screenType === 'serial'
          ? calculateConfidence(newSerialCandidates)
          : calculateConfidence(newImeiCandidates);

        // Check if we can confirm values (3+ consistent reads)
        const confirmedSerial = getMostFrequent(newSerialCandidates, 3);
        const confirmedImei = getMostFrequent(newImeiCandidates, 3);
        const confirmedImei2 = getMostFrequent(newImei2Candidates, 3);

        // Capture image when value is first confirmed
        let serialImage = prev.serialImage;
        let imeiImage = prev.imeiImage;

        if (screenType === 'serial' && confirmedSerial && !prev.confirmedSerial) {
          serialImage = currentFrameImage;
        }
        if (screenType === 'imei' && confirmedImei && !prev.confirmedImei) {
          imeiImage = currentFrameImage;
        }

        // Determine phase based on current screen type
        let phase: DetectionPhase = 'detecting';
        if (screenType === 'serial' && confirmedSerial) {
          phase = 'locking';
        } else if (screenType === 'imei' && confirmedImei) {
          phase = 'locking';
        }

        // Both confirmed = fully done
        if (confirmedSerial && confirmedImei) {
          phase = 'confirmed';
        }

        return {
          ...prev,
          phase,
          currentScreen: screenType,
          confidence: currentConfidence,
          serialCandidates: newSerialCandidates,
          imeiCandidates: newImeiCandidates,
          imei2Candidates: newImei2Candidates,
          confirmedSerial,
          confirmedImei,
          confirmedImei2,
          serialImage,
          imeiImage,
          frameCount: prev.frameCount + 1,
        };
      });

      // Status updates handled via useEffect for notifications

    } catch (err) {
      console.error('Detection error:', err);
    }

    isProcessingRef.current = false;

    // Schedule next detection
    const delay = detection.phase === 'detecting' || detection.phase === 'locking' ? 500 : 300;
    setTimeout(() => {
      detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
    }, delay);
  }, [isCameraActive, testImagePath, testImageLoaded, detection.phase, captureFrame, runFastDetection, runFullExtraction]);

  // Start/stop detection loop
  useEffect(() => {
    const isActive = isCameraActive || (testImagePath && testImageLoaded);
    if (isActive && workerRef.current && detection.phase !== 'confirmed') {
      detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
    }
    return () => {
      if (detectLoopRef.current) {
        cancelAnimationFrame(detectLoopRef.current);
      }
    };
  }, [isCameraActive, testImagePath, testImageLoaded, runDetectionLoop, detection.phase]);

  // Notifications when values are confirmed
  useEffect(() => {
    if (detection.confirmedSerial && !notifiedRef.current.serial) {
      notifiedRef.current.serial = true;
      addSnackbar({ message: `Serial confirmed: ${detection.confirmedSerial}`, type: 'success' });
    }
    if (detection.confirmedImei && !notifiedRef.current.imei) {
      notifiedRef.current.imei = true;
      addSnackbar({ message: `IMEI confirmed: ${formatImei(detection.confirmedImei)}`, type: 'success' });
    }
    if (detection.confirmedSerial && detection.confirmedImei && !notifiedRef.current.all) {
      notifiedRef.current.all = true;
      addSnackbar({ message: 'All values collected!', type: 'success' });
    }
  }, [detection.confirmedSerial, detection.confirmedImei, addSnackbar]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      setTestImagePath('');

      // Check if mediaDevices is available (requires HTTPS or localhost)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera not available. This feature requires HTTPS or localhost access.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
      setStatus('Scanning for iPhone About screen...');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Camera permission denied. Please allow camera access and try again.');
      } else {
        setError(`Camera error: ${message}. Try using localhost or HTTPS.`);
      }
    }
  }, [cameraFacing]);

  const stopCamera = useCallback(() => {
    if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraActive(false);
    setStatus('Camera stopped');
  }, []);

  const resetResults = useCallback(() => {
    setDetection({
      phase: 'scanning',
      currentScreen: 'none',
      confidence: 0,
      serialCandidates: [],
      imeiCandidates: [],
      imei2Candidates: [],
      confirmedSerial: null,
      confirmedImei: null,
      confirmedImei2: null,
      serialImage: null,
      imeiImage: null,
      frameCount: 0,
    });
    notifiedRef.current = { serial: false, imei: false, all: false };
    setStatus(isCameraActive ? 'Scanning for iPhone About screen...' : 'Ready');
  }, [isCameraActive]);

  const handleTestImageChange = useCallback((path: string) => {
    setTestImagePath(path);
    setTestImageLoaded(false);
    if (!path) {
      setStatus('Ready - Start camera or select test image');
    } else {
      setStatus('Loading test image...');
    }
    resetResults();
    if (isCameraActive) {
      stopCamera();
    }
  }, [isCameraActive, stopCamera, resetResults]);

  // Phase indicator colors
  const getPhaseColor = (phase: DetectionPhase) => {
    switch (phase) {
      case 'scanning': return 'bg-fg/30';
      case 'detecting': return 'bg-warning';
      case 'locking': return 'bg-info animate-pulse';
      case 'confirmed': return 'bg-success';
    }
  };

  const getPhaseText = (phase: DetectionPhase) => {
    switch (phase) {
      case 'scanning': return 'Scanning';
      case 'detecting': return 'Detecting';
      case 'locking': return 'Locking';
      case 'confirmed': return 'Confirmed';
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-title font-semibold mb-4">iPhone Serial/IMEI Scanner</h1>
      <p className="text-fg/60 mb-4 text-sm">
        Point camera at iPhone Settings &gt; General &gt; About screen to extract Serial Number and IMEI.
      </p>

      {error && (
        <div className="p-3 mb-4 bg-danger/10 border border-danger rounded-lg text-danger">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="w-40">
          <label className="form-label block mb-1">Camera</label>
          <Select
            options={cameraOptions}
            value={cameraFacing}
            onChange={(val) => setCameraFacing(val as string)}
            disabled={isCameraActive}
          />
        </div>

        <div className="w-40">
          <label className="form-label block mb-1">Test Image</label>
          <Select
            options={testImageOptions}
            value={testImagePath}
            onChange={(val) => handleTestImageChange(val as string)}
            disabled={isCameraActive}
          />
        </div>

        {!isCameraActive && !testImagePath ? (
          <Button onClick={startCamera} color="primary">
            <Camera size={16} className="mr-2" />
            Start Camera
          </Button>
        ) : isCameraActive ? (
          <Button onClick={stopCamera} color="secondary" variant="outline">
            <CameraOff size={16} className="mr-2" />
            Stop
          </Button>
        ) : null}

        <Button
          onClick={resetResults}
          variant="outline"
          disabled={detection.frameCount === 0}
        >
          <RotateCcw size={16} className="mr-2" />
          Reset
        </Button>

        <LabeledCheckbox
          label="Show low-res preview"
          checked={showLowResPreview}
          onChange={(e) => setShowLowResPreview(e.target.checked)}
        />
      </div>

      {/* Status bar with phase indicator - fixed height */}
      <div className="p-3 mb-4 rounded bg-surface border border-line h-24">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`w-3 h-3 rounded-full ${getPhaseColor(detection.phase)}`} />
          <span className="font-medium">{getPhaseText(detection.phase)}</span>
          {detection.currentScreen !== 'none' ? (
            <>
              <span className="text-fg/60">|</span>
              <span className="text-sm px-2 py-0.5 rounded bg-primary/20 text-primary">
                {detection.currentScreen === 'serial' ? 'Serial Screen' : 'IMEI Screen'}
              </span>
            </>
          ) : (
            <>
              <span className="text-fg/60">|</span>
              <span className="text-sm px-2 py-0.5 rounded bg-surface-shallow text-fg/40">
                -
              </span>
            </>
          )}
          <span className="text-fg/60">|</span>
          <span className="text-sm text-fg/70">{status}</span>
          <span className="ml-auto text-sm text-fg/50">
            {detection.frameCount} frames
          </span>
        </div>

        {/* Confidence meter - always visible */}
        <div className="mt-2">
          <div className="flex justify-between text-xs text-fg/60 mb-1">
            <span>Confidence</span>
            <span>{detection.confidence}%</span>
          </div>
          <div className="h-2 bg-surface-shallow rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                detection.confidence >= 80 ? 'bg-success' :
                detection.confidence >= 50 ? 'bg-warning' : 'bg-danger'
              }`}
              style={{ width: `${detection.confidence}%` }}
            />
          </div>
        </div>
      </div>

      {/* Camera/Image feed - fixed height */}
      <div className="mb-4 relative bg-black rounded-lg overflow-hidden h-64">
        {testImagePath ? (
          <img
            ref={testImageRef}
            src={testImagePath}
            alt="Test"
            className="w-full h-full object-contain"
            onLoad={() => {
              setTestImageLoaded(true);
              setStatus('Test image loaded - analyzing...');
            }}
            onError={() => setError('Failed to load test image')}
          />
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            muted
          />
        )}
        <canvas ref={canvasRef} className={showLowResPreview ? 'absolute top-2 right-2 w-32 border border-white/50' : 'hidden'} />

        {!isCameraActive && !testImagePath && (
          <div className="absolute inset-0 flex items-center justify-center text-white/50 flex-col gap-2">
            <ImageIcon size={48} />
            <span>Select test image or start camera</span>
          </div>
        )}

        {/* Detection overlay */}
        {detection.phase !== 'scanning' && (
          <div className={`absolute inset-0 border-4 pointer-events-none ${
            detection.phase === 'confirmed' ? 'border-success' :
            detection.phase === 'locking' ? 'border-info animate-pulse' :
            'border-warning'
          }`} />
        )}
      </div>

      {/* Live candidates - fixed height, always visible */}
      <div className="mb-4 p-2 bg-surface-shallow rounded-lg h-16">
        <div className="grid grid-cols-2 gap-4 text-xs h-full">
          <div className="overflow-hidden">
            <div className="text-fg/50 mb-1">Serial Candidates ({detection.serialCandidates.length})</div>
            <div className="font-mono truncate">
              {[...new Set(detection.serialCandidates)].slice(-3).join(', ') || '-'}
            </div>
          </div>
          <div className="overflow-hidden">
            <div className="text-fg/50 mb-1">IMEI Candidates ({detection.imeiCandidates.length})</div>
            <div className="font-mono truncate">
              {[...new Set(detection.imeiCandidates)].slice(-3).join(', ') || '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Results - fixed height, always visible */}
      <div className="grid grid-cols-2 gap-3">
        {/* Serial Number */}
        <div className={`p-3 rounded-lg border h-32 ${
          detection.confirmedSerial
            ? 'bg-success/10 border-success'
            : 'bg-surface border-line'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-fg/60">Serial Number</span>
            {detection.confirmedSerial ? (
              <Check size={14} className="text-success" />
            ) : (
              <span className="text-xs text-fg/40">waiting...</span>
            )}
          </div>
          <div className="font-mono font-semibold truncate text-sm">
            {detection.confirmedSerial || '-'}
          </div>
          {detection.serialImage ? (
            <img
              src={detection.serialImage}
              alt="Serial capture"
              className="mt-2 w-full h-14 object-contain rounded opacity-80 cursor-pointer hover:opacity-100"
              onClick={() => setViewingImage(detection.serialImage)}
            />
          ) : (
            <div className="mt-2 w-full h-14 bg-surface-shallow rounded flex items-center justify-center text-xs text-fg/30">
              No capture
            </div>
          )}
        </div>

        {/* IMEI */}
        <div className={`p-3 rounded-lg border h-32 ${
          detection.confirmedImei
            ? 'bg-success/10 border-success'
            : 'bg-surface border-line'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-fg/60">
              IMEI
              {detection.confirmedImei && isValidImei(detection.confirmedImei) && (
                <span className="ml-1 text-success">(valid)</span>
              )}
            </span>
            {detection.confirmedImei ? (
              <Check size={14} className="text-success" />
            ) : (
              <span className="text-xs text-fg/40">waiting...</span>
            )}
          </div>
          <div className="font-mono font-semibold truncate text-sm">
            {detection.confirmedImei ? formatImei(detection.confirmedImei) : '-'}
          </div>
          {detection.imeiImage ? (
            <img
              src={detection.imeiImage}
              alt="IMEI capture"
              className="mt-2 w-full h-14 object-contain rounded opacity-80 cursor-pointer hover:opacity-100"
              onClick={() => setViewingImage(detection.imeiImage)}
            />
          ) : (
            <div className="mt-2 w-full h-14 bg-surface-shallow rounded flex items-center justify-center text-xs text-fg/30">
              No capture
            </div>
          )}
        </div>
      </div>

      {/* Image viewer modal */}
      <Modal
        open={!!viewingImage}
        onClose={() => setViewingImage(null)}
      >
        {viewingImage && (
          <img
            src={viewingImage}
            alt="Captured"
            className="w-full max-h-[70vh] object-contain"
            onClick={() => setViewingImage(null)}
          />
        )}
      </Modal>
    </div>
  );
}
