import { useState, useRef, useCallback, useEffect } from 'react';
import Tesseract, { PSM, OEM } from 'tesseract.js';
import { Button, ProgressBar, Select, LabeledCheckbox } from 'tsp-form';
import { Camera, CameraOff, RotateCcw } from 'lucide-react';

// Thai ID card field regions (relative to card bounds, as percentages)
// Based on standard Thai ID card layout
const CARD_REGIONS = {
  idNumber: { x: 0.35, y: 0.05, w: 0.63, h: 0.08 },      // Top right - "1 3193 00006 29 6"
  nameThai: { x: 0.22, y: 0.13, w: 0.55, h: 0.08 },      // Thai name row
  nameEnglish: { x: 0.22, y: 0.21, w: 0.55, h: 0.06 },   // "Name Miss Patchayamon"
  lastNameEnglish: { x: 0.22, y: 0.27, w: 0.55, h: 0.06 }, // "Last name Warittrakulchai"
  dateOfBirth: { x: 0.22, y: 0.33, w: 0.55, h: 0.08 },   // DOB row
  dateOfIssue: { x: 0.05, y: 0.75, w: 0.30, h: 0.12 },   // Bottom left dates
  dateOfExpiry: { x: 0.55, y: 0.75, w: 0.30, h: 0.12 },  // Bottom right dates
  laserId: { x: 0.55, y: 0.88, w: 0.43, h: 0.08 },       // Bottom - laser code
};

type FieldKey = keyof typeof CARD_REGIONS;

interface FieldResult {
  field: FieldKey;
  values: { value: string; count: number }[];
  bestValue?: string;
}

interface CardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const cameraOptions = [
  { value: 'environment', label: 'Back Camera' },
  { value: 'user', label: 'Front Camera' },
];

const FIELD_LABELS: Record<FieldKey, string> = {
  idNumber: 'ID Number',
  nameThai: 'Name (Thai)',
  nameEnglish: 'Name (English)',
  lastNameEnglish: 'Last Name',
  dateOfBirth: 'Date of Birth',
  dateOfIssue: 'Date of Issue',
  dateOfExpiry: 'Date of Expiry',
  laserId: 'Laser ID',
};

// Clean OCR text for specific field types
function cleanFieldValue(field: FieldKey, text: string): string | null {
  const cleaned = text.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned) return null;

  switch (field) {
    case 'idNumber': {
      // Extract 13 digits
      const digits = cleaned.replace(/\D/g, '');
      if (digits.length >= 13) return digits.slice(0, 13);
      if (digits.length >= 10) return digits; // Partial match
      return null;
    }
    case 'laserId': {
      // Format: XXXX-XX-XXXXXXXX
      const match = cleaned.match(/(\d{4})-?(\d{2})-?(\d{8})/);
      if (match) return `${match[1]}-${match[2]}-${match[3]}`;
      return null;
    }
    case 'dateOfBirth':
    case 'dateOfIssue':
    case 'dateOfExpiry': {
      // Look for date pattern
      const match = cleaned.match(/(\d{1,2})\s*(\w{3,}\.?)\s*(\d{4})/i);
      if (match) return `${match[1]} ${match[2]} ${match[3]}`;
      return null;
    }
    case 'nameEnglish': {
      const match = cleaned.match(/(Miss|Mr\.?|Mrs\.?|Ms\.?)\s+([A-Za-z]+)/i);
      if (match) return `${match[1]} ${match[2]}`;
      return cleaned.length > 2 ? cleaned : null;
    }
    case 'lastNameEnglish': {
      const match = cleaned.match(/([A-Za-z]{3,})/);
      return match ? match[1] : null;
    }
    default:
      return cleaned.length > 1 ? cleaned : null;
  }
}

export function CameraOcrPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fastWorkerRef = useRef<Tesseract.Worker | null>(null);
  const fullWorkerRef = useRef<Tesseract.Worker | null>(null);
  const detectLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<string>('environment');
  const [cardDetected, setCardDetected] = useState(false);
  const [fieldResults, setFieldResults] = useState<Map<FieldKey, string[]>>(new Map());
  const [scanProgress, setScanProgress] = useState<Record<FieldKey, number>>({} as Record<FieldKey, number>);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [autoExtract, setAutoExtract] = useState(true);
  const [frameCount, setFrameCount] = useState(0);

  // Initialize workers
  useEffect(() => {
    const init = async () => {
      try {
        setStatus('Loading OCR engines...');

        // Fast worker for card detection (legacy engine, faster)
        const fastWorker = await Tesseract.createWorker('eng', OEM.LSTM_ONLY);
        await fastWorker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        });
        fastWorkerRef.current = fastWorker;

        // Full worker for field extraction
        const fullWorker = await Tesseract.createWorker('eng+tha', OEM.LSTM_ONLY);
        fullWorkerRef.current = fullWorker;

        setStatus('Ready - Start camera to begin');
      } catch (err) {
        setError(`Failed to init OCR: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    };
    init();

    return () => {
      fastWorkerRef.current?.terminate();
      fullWorkerRef.current?.terminate();
    };
  }, []);

  // Capture current frame to canvas
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas;
  }, []);

  // Crop a region from canvas
  const cropRegion = useCallback((
    sourceCanvas: HTMLCanvasElement,
    bounds: CardBounds,
    region: { x: number; y: number; w: number; h: number }
  ): string => {
    const cropCanvas = document.createElement('canvas');
    const ctx = cropCanvas.getContext('2d')!;

    const cropX = bounds.x + bounds.width * region.x;
    const cropY = bounds.y + bounds.height * region.y;
    const cropW = bounds.width * region.w;
    const cropH = bounds.height * region.h;

    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return cropCanvas.toDataURL('image/jpeg', 0.9);
  }, []);

  // Fast detection - find card in frame
  const detectCard = useCallback(async (canvas: HTMLCanvasElement): Promise<CardBounds | null> => {
    const worker = fastWorkerRef.current;
    if (!worker) return null;

    try {
      const imageData = canvas.toDataURL('image/jpeg', 0.6); // Lower quality for speed
      const result = await worker.recognize(imageData, {}, { blocks: true });
      const text = result.data.text;

      // Check for Thai ID card indicators
      const hasIdPattern = /\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d/.test(text) ||
                          /\d{10,13}/.test(text.replace(/\s/g, ''));
      const hasKeywords = /thai|national|id|card|identification|name|birth/i.test(text);

      if (!hasIdPattern && !hasKeywords) return null;

      // Extract all words from blocks -> paragraphs -> lines -> words
      const words: Tesseract.Word[] = [];
      result.data.blocks?.forEach(block => {
        block.paragraphs.forEach(para => {
          para.lines.forEach(line => {
            words.push(...line.words);
          });
        });
      });

      if (words.length < 3) return null;

      // Find bounding box of all detected text
      let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
      words.forEach(word => {
        const bbox = word.bbox;
        minX = Math.min(minX, bbox.x0);
        minY = Math.min(minY, bbox.y0);
        maxX = Math.max(maxX, bbox.x1);
        maxY = Math.max(maxY, bbox.y1);
      });

      // Expand bounds to estimate full card (text doesn't cover edges)
      const textWidth = maxX - minX;
      const textHeight = maxY - minY;
      const padding = 0.1; // 10% padding

      return {
        x: Math.max(0, minX - textWidth * padding),
        y: Math.max(0, minY - textHeight * padding),
        width: Math.min(canvas.width - minX + textWidth * padding, textWidth * (1 + padding * 2)),
        height: Math.min(canvas.height - minY + textHeight * padding, textHeight * (1 + padding * 2)),
      };
    } catch {
      return null;
    }
  }, []);

  // Extract a single field from cropped region
  const extractField = useCallback(async (
    canvas: HTMLCanvasElement,
    bounds: CardBounds,
    field: FieldKey
  ): Promise<string | null> => {
    const worker = fullWorkerRef.current;
    if (!worker) return null;

    const region = CARD_REGIONS[field];
    const croppedImage = cropRegion(canvas, bounds, region);

    // Set appropriate PSM for the field type
    const psm = field === 'idNumber' || field === 'laserId'
      ? PSM.SINGLE_LINE
      : PSM.SINGLE_BLOCK;

    await worker.setParameters({ tessedit_pageseg_mode: psm });

    const result = await worker.recognize(croppedImage);
    return cleanFieldValue(field, result.data.text);
  }, [cropRegion]);

  // Draw overlay showing detected card and regions
  const drawOverlay = useCallback((bounds: CardBounds | null) => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    const ctx = overlay.getContext('2d')!;
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!bounds) return;

    // Draw card bounds
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // Draw field regions
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';

    Object.entries(CARD_REGIONS).forEach(([, region]) => {
      const x = bounds.x + bounds.width * region.x;
      const y = bounds.y + bounds.height * region.y;
      const w = bounds.width * region.w;
      const h = bounds.height * region.h;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    });
  }, []);

  // Main detection loop
  const runDetectionLoop = useCallback(async () => {
    if (!isCameraActive || isProcessingRef.current) {
      setTimeout(() => {
        detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
      }, 100);
      return;
    }

    isProcessingRef.current = true;
    let foundCard = false;
    const canvas = captureFrame();

    if (canvas) {
      const bounds = await detectCard(canvas);
      foundCard = !!bounds;
      setCardDetected(foundCard);
      drawOverlay(bounds);

      if (bounds && autoExtract) {
        setFrameCount(prev => prev + 1);
        setStatus('Card detected - extracting fields...');

        // Extract all fields from cropped regions
        const fields = Object.keys(CARD_REGIONS) as FieldKey[];

        for (const field of fields) {
          setScanProgress(prev => ({ ...prev, [field]: 50 }));
          const value = await extractField(canvas, bounds, field);
          setScanProgress(prev => ({ ...prev, [field]: 100 }));

          if (value) {
            setFieldResults(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(field) || [];
              newMap.set(field, [...existing, value]);
              return newMap;
            });
          }
        }

        setStatus('Scanning...');
      } else if (!bounds) {
        setStatus('Point camera at Thai ID card...');
      }
    }

    isProcessingRef.current = false;

    // Schedule next detection with adaptive timing
    setTimeout(() => {
      detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
    }, foundCard ? 1000 : 300);
  }, [isCameraActive, autoExtract, captureFrame, detectCard, extractField, drawOverlay]);

  // Start/stop detection loop with camera
  useEffect(() => {
    if (isCameraActive && fastWorkerRef.current && fullWorkerRef.current) {
      detectLoopRef.current = requestAnimationFrame(runDetectionLoop);
    }
    return () => {
      if (detectLoopRef.current) {
        cancelAnimationFrame(detectLoopRef.current);
      }
    };
  }, [isCameraActive, runDetectionLoop]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
      setStatus('Scanning for card...');
    } catch (err) {
      setError(`Camera error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }, [cameraFacing]);

  const stopCamera = useCallback(() => {
    if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraActive(false);
    setCardDetected(false);
    setStatus('Camera stopped');
  }, []);

  const resetResults = useCallback(() => {
    setFieldResults(new Map());
    setFrameCount(0);
    setScanProgress({} as Record<FieldKey, number>);
  }, []);

  // Aggregate results - find most common value per field
  const getAggregatedResults = useCallback((): FieldResult[] => {
    const results: FieldResult[] = [];

    fieldResults.forEach((values, field) => {
      const counts = new Map<string, number>();
      values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));

      const sorted = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

      results.push({
        field,
        values: sorted,
        bestValue: sorted[0]?.value,
      });
    });

    return results;
  }, [fieldResults]);

  const aggregated = getAggregatedResults();

  return (
    <div className="max-w-4xl">
      <h1 className="text-title font-semibold mb-4">Camera OCR - Thai ID Card</h1>

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

        {!isCameraActive ? (
          <Button onClick={startCamera} color="primary">
            <Camera size={16} className="mr-2" />
            Start
          </Button>
        ) : (
          <Button onClick={stopCamera} color="secondary" variant="outline">
            <CameraOff size={16} className="mr-2" />
            Stop
          </Button>
        )}

        <Button onClick={resetResults} variant="outline" disabled={fieldResults.size === 0}>
          <RotateCcw size={16} className="mr-2" />
          Reset
        </Button>

        <LabeledCheckbox
          label="Auto-extract fields"
          checked={autoExtract}
          onChange={(e) => setAutoExtract(e.target.checked)}
        />
      </div>

      {/* Status bar */}
      <div className={`p-2 mb-4 rounded text-sm flex items-center gap-2 ${
        cardDetected ? 'bg-success/10 text-success' : 'bg-surface-shallow'
      }`}>
        <span className={`w-2 h-2 rounded-full ${cardDetected ? 'bg-success' : 'bg-fg/30'}`} />
        {status}
        {frameCount > 0 && <span className="ml-auto text-fg/50">{frameCount} frames captured</span>}
      </div>

      {/* Camera feed with overlay */}
      <div className="mb-4 relative bg-black rounded-lg overflow-hidden">
        <video ref={videoRef} className="w-full max-h-[400px] object-contain" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
        {!isCameraActive && (
          <div className="absolute inset-0 flex items-center justify-center text-white/50">
            Camera inactive
          </div>
        )}
      </div>

      {/* Field extraction progress */}
      {Object.keys(scanProgress).length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(Object.keys(CARD_REGIONS) as FieldKey[]).map(field => (
            <div key={field} className="text-xs">
              <span className="text-fg/70">{FIELD_LABELS[field]}</span>
              <ProgressBar value={scanProgress[field] || 0} size="sm" />
            </div>
          ))}
        </div>
      )}

      {/* Aggregated results */}
      {aggregated.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Extracted Fields</h2>
          <p className="text-sm text-fg/60 mb-3">
            Values ranked by frequency. Higher count = more reliable.
          </p>

          <div className="grid gap-2">
            {aggregated.map(({ field, values, bestValue }) => (
              <div key={field} className="p-3 bg-surface border border-line rounded-lg">
                <div className="text-sm text-fg/70 mb-1">{FIELD_LABELS[field]}</div>
                <div className="font-mono font-medium">{bestValue}</div>
                {values.length > 1 && (
                  <div className="mt-1 text-xs text-fg/50">
                    {values.map((v, i) => (
                      <span key={i} className={v.value === bestValue ? 'text-success' : ''}>
                        {v.value} ({v.count}x){i < values.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
