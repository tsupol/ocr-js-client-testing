import { useState, useRef, useEffect, useCallback } from 'react';
import Tesseract, { PSM, OEM } from 'tesseract.js';
import { Button, Select } from 'tsp-form';
import { Camera, Upload, Image as ImageIcon } from 'lucide-react';

const SAMPLE_IMAGE = '/test-serial-imei/sample_serial.jpg';

// Serial pattern: 10-12 alphanumeric chars
const SERIAL_PATTERN = /[A-Z0-9]{10,12}/g;

const psmOptions = [
  { value: String(PSM.AUTO), label: 'AUTO (3)' },
  { value: String(PSM.SINGLE_BLOCK), label: 'SINGLE_BLOCK (6)' },
  { value: String(PSM.SINGLE_LINE), label: 'SINGLE_LINE (7)' },
  { value: String(PSM.SINGLE_WORD), label: 'SINGLE_WORD (8)' },
  { value: String(PSM.SPARSE_TEXT), label: 'SPARSE_TEXT (11)' },
];

const oemOptions = [
  { value: String(OEM.LSTM_ONLY), label: 'LSTM Only (1) - Accurate' },
  { value: String(OEM.TESSERACT_ONLY), label: 'Legacy (0) - Fast' },
  { value: String(OEM.TESSERACT_LSTM_COMBINED), label: 'Combined (2)' },
  { value: String(OEM.DEFAULT), label: 'Default (3)' },
];

const sizeOptions = [
  { value: '100', label: '100%' },
  { value: '150', label: '150%' },
  { value: '200', label: '200%' },
  { value: '300', label: '300%' },
  { value: '400', label: '400%' },
  { value: '500', label: '500%' },
  { value: '600', label: '600%' },
];

const langDataOptions = [
  { value: 'best', label: 'Best (accurate)' },
  { value: 'fast', label: 'Fast (speed)' },
];

const whitelistOptions = [
  { value: '', label: 'None (all chars)' },
  { value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', label: 'A-Z 0-9 only' },
  { value: 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', label: 'A-Z 0-9 (no I/O)' }, // Apple serial style
  { value: '0123456789', label: '0-9 only (IMEI)' },
];

const preprocessOptions = [
  { value: 'none', label: 'None' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'threshold', label: 'Threshold (B&W)' },
  { value: 'invert', label: 'Invert' },
  { value: 'sharpen', label: 'Sharpen' },
];

export function OcrDebugPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState('Loading...');
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [scale, setScale] = useState('400');
  const [psm, setPsm] = useState(String(PSM.SINGLE_LINE));
  const [oem, setOem] = useState(String(OEM.LSTM_ONLY));
  const [langData, setLangData] = useState('best');
  const [whitelist, setWhitelist] = useState('');
  const [preprocess, setPreprocess] = useState('none');
  const [ocrResult, setOcrResult] = useState<string>('');
  const [serialResult, setSerialResult] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [canvasDataUrl, setCanvasDataUrl] = useState<string>('');
  const [detectImageUrl, setDetectImageUrl] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [ocrTime, setOcrTime] = useState<number | null>(null);
  const [cropInfo, setCropInfo] = useState<string>('');
  const [detectedLabel, setDetectedLabel] = useState<string>('');
  const [srcInfo, setSrcInfo] = useState<string>('');
  const [pass1Info, setPass1Info] = useState<string>('');

  // Initialize/reinitialize worker when OEM or langData changes
  useEffect(() => {
    const init = async () => {
      // Terminate existing worker
      if (workerRef.current) {
        await workerRef.current.terminate();
        workerRef.current = null;
      }

      const oemMode = parseInt(oem) as OEM;
      const oemLabel = oemOptions.find(o => o.value === oem)?.label || oem;
      const langLabel = langDataOptions.find(o => o.value === langData)?.label || langData;
      setStatus(`Loading OCR engine (${oemLabel}, ${langLabel})...`);

      // Use fast or best language data
      const langPath = langData === 'fast'
        ? 'https://tessdata.projectnaptha.com/4.0.0_fast'
        : 'https://tessdata.projectnaptha.com/4.0.0_best';

      const worker = await Tesseract.createWorker('eng', oemMode, {
        langPath,
      });
      workerRef.current = worker;
      setStatus('Ready - choose image source');
    };
    init();

    return () => {
      workerRef.current?.terminate();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [oem, langData]);

  // Load sample image
  const loadSampleImage = useCallback(() => {
    setSourceImage(SAMPLE_IMAGE);
    setStatus('Sample image loaded');
    stopCamera();
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setSourceImage(ev.target?.result as string);
      setStatus('Uploaded image loaded');
      stopCamera();
    };
    reader.readAsDataURL(file);
  }, []);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setSourceImage(null);
      setStatus('Camera active - tap Snap to capture');
    } catch (err) {
      setStatus(`Camera error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  // Snap photo from camera
  const snapPhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setSourceImage(dataUrl);
    stopCamera();
    setStatus('Photo captured');
  }, [stopCamera]);

  const runOcr = async () => {
    if (!workerRef.current || !sourceImage || !canvasRef.current) return;

    setProcessing(true);
    const startTime = performance.now();

    // Load image to get dimensions
    const img = new Image();
    img.src = sourceImage;
    await new Promise(resolve => img.onload = resolve);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    // === PASS 1: Detect label at 100% (no scaling) ===
    setSrcInfo(`${img.naturalWidth}x${img.naturalHeight}`);

    setStatus('Pass 1: Detecting label at 100%...');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    setPass1Info(`${canvas.width}x${canvas.height}`);

    const fullImageData = canvas.toDataURL('image/png');
    setDetectImageUrl(fullImageData);

    // Run OCR to find "Serial" label - use SPARSE_TEXT for detection
    await workerRef.current.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    // Pass { blocks: true } to get word/line bounding boxes
    const detectResult = await workerRef.current.recognize(fullImageData, {}, { blocks: true });

    // Extract lines from blocks -> paragraphs -> lines
    const allLines: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
    if (detectResult.data.blocks) {
      for (const block of detectResult.data.blocks) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            allLines.push({ text: line.text, bbox: line.bbox });
          }
        }
      }
    }

    // Find line containing "serial"
    const serialLine = allLines.find(l =>
      l.text.toLowerCase().includes('serial')
    );

    setDetectedLabel(serialLine ? `Found: "${serialLine.text}" at ${JSON.stringify(serialLine.bbox)}` : `Not found. Lines: ${allLines.map(l => l.text).join(' | ')}`);

    if (!serialLine) {
      const endTime = performance.now();
      setOcrTime(Math.round(endTime - startTime));
      setStatus('Could not find "Serial" label');
      setOcrResult(`Lines found: ${allLines.map(l => l.text).join(' | ')}\n\n${detectResult.data.text}`);
      setSerialResult('Not found');
      setCanvasDataUrl('');
      setProcessing(false);
      return;
    }

    // === PASS 2: Crop region and scale up ===
    setStatus(`Pass 2: Cropping and scaling ${scale}%...`);
    const bbox = serialLine.bbox;

    // Expand crop area with padding and extend right for the value
    const labelW = bbox.x1 - bbox.x0;
    const labelH = bbox.y1 - bbox.y0;
    const padding = 30;

    // Start from label, extend to right edge of image to capture value
    const cropX = Math.max(0, bbox.x0 - padding);
    const cropY = Math.max(0, bbox.y0 - padding);
    const cropW = Math.min(img.naturalWidth - cropX, img.naturalWidth - bbox.x0 + padding);
    const cropH = labelH + padding * 2;

    setCropInfo(`bbox: ${Math.round(bbox.x0)},${Math.round(bbox.y0)} ${Math.round(labelW)}x${Math.round(labelH)} | crop: ${Math.round(cropX)},${Math.round(cropY)} ${Math.round(cropW)}x${Math.round(cropH)}`);

    // Scale factor for extraction
    const extractScale = parseInt(scale) / 100;

    // Create scaled crop
    canvas.width = cropW * extractScale;
    canvas.height = cropH * extractScale;
    ctx.drawImage(
      img,
      cropX, cropY, cropW, cropH, // source
      0, 0, canvas.width, canvas.height // dest
    );

    // Apply preprocessing if selected
    if (preprocess !== 'none') {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      if (preprocess === 'grayscale') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          data[i] = data[i + 1] = data[i + 2] = gray;
        }
      } else if (preprocess === 'threshold') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const val = gray > 128 ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = val;
        }
      } else if (preprocess === 'invert') {
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];
          data[i + 1] = 255 - data[i + 1];
          data[i + 2] = 255 - data[i + 2];
        }
      } else if (preprocess === 'sharpen') {
        const copy = new Uint8ClampedArray(data);
        const w = canvas.width;
        for (let y = 1; y < canvas.height - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
              const center = copy[idx + c] * 5;
              const neighbors = copy[idx - 4 + c] + copy[idx + 4 + c] +
                copy[idx - w * 4 + c] + copy[idx + w * 4 + c];
              data[idx + c] = Math.min(255, Math.max(0, center - neighbors));
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const croppedImageData = canvas.toDataURL('image/png');
    setCanvasDataUrl(croppedImageData);

    // Set params for extraction
    const params: Partial<Tesseract.WorkerParams> = {
      tessedit_pageseg_mode: parseInt(psm) as PSM,
    };
    if (whitelist) {
      (params as Record<string, unknown>).tessedit_char_whitelist = whitelist;
    }
    await workerRef.current.setParameters(params);

    // Run OCR on cropped region
    const extractResult = await workerRef.current.recognize(croppedImageData);
    const text = extractResult.data.text;

    const endTime = performance.now();
    const elapsed = Math.round(endTime - startTime);
    setOcrTime(elapsed);

    // Extract serial pattern
    const matches = text.match(SERIAL_PATTERN);
    const serial = matches ? matches[0] : 'Not found';

    setOcrResult(text);
    setSerialResult(serial);
    setStatus(`Done - 2-pass OCR - ${elapsed}ms total`);
    setProcessing(false);
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-title font-semibold mb-4">Serial OCR Debug</h1>
      <p className="text-fg/60 mb-4 text-sm">
        Test OCR on serial number images with different scales and PSM modes.
      </p>

      {/* Image source buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={loadSampleImage} variant="outline">
          <ImageIcon size={16} className="mr-2" />
          Sample Image
        </Button>
        <Button onClick={() => fileInputRef.current?.click()} variant="outline">
          <Upload size={16} className="mr-2" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />
        {!cameraActive ? (
          <Button onClick={startCamera} variant="outline">
            <Camera size={16} className="mr-2" />
            Camera
          </Button>
        ) : (
          <Button onClick={snapPhoto} color="primary">
            <Camera size={16} className="mr-2" />
            Snap
          </Button>
        )}
      </div>

      {/* OCR Controls - Row 1 */}
      <div className="flex flex-wrap gap-3 mb-3 items-end">
        <div className="w-28">
          <label className="form-label block mb-1">Scale</label>
          <Select
            options={sizeOptions}
            value={scale}
            onChange={(val) => setScale(val as string)}
          />
        </div>

        <div className="w-48">
          <label className="form-label block mb-1">PSM Mode</label>
          <Select
            options={psmOptions}
            value={psm}
            onChange={(val) => setPsm(val as string)}
          />
        </div>

        <div className="w-52">
          <label className="form-label block mb-1">OEM (Engine)</label>
          <Select
            options={oemOptions}
            value={oem}
            onChange={(val) => setOem(val as string)}
          />
        </div>

        <div className="w-36">
          <label className="form-label block mb-1">Lang Data</label>
          <Select
            options={langDataOptions}
            value={langData}
            onChange={(val) => setLangData(val as string)}
          />
        </div>
      </div>

      {/* OCR Controls - Row 2 */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="w-44">
          <label className="form-label block mb-1">Whitelist</label>
          <Select
            options={whitelistOptions}
            value={whitelist}
            onChange={(val) => setWhitelist(val as string)}
          />
        </div>

        <div className="w-36">
          <label className="form-label block mb-1">Preprocess</label>
          <Select
            options={preprocessOptions}
            value={preprocess}
            onChange={(val) => setPreprocess(val as string)}
          />
        </div>

        <Button onClick={runOcr} color="primary" disabled={!sourceImage || processing}>
          Run OCR
        </Button>
      </div>

      {/* Status */}
      <div className="p-2 mb-4 rounded bg-surface border border-line text-sm">
        {status}
      </div>

      {/* Serial Result */}
      {serialResult && (
        <div className="mb-4 p-3 bg-success/10 border border-success rounded">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-fg/60">Detected Serial</span>
            {ocrTime !== null && (
              <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded">
                {ocrTime}ms
              </span>
            )}
          </div>
          <div className="font-mono text-xl font-bold">{serialResult}</div>
        </div>
      )}

      {/* Camera preview */}
      {cameraActive && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2">Camera</h3>
          <video ref={videoRef} className="w-full max-h-48 object-contain border border-line bg-black" playsInline muted />
        </div>
      )}

      {/* Images row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Source image */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Source {srcInfo && `(${srcInfo})`}</h3>
          <div className="border border-line bg-black h-40 flex items-center justify-center">
            {sourceImage && !cameraActive ? (
              <img src={sourceImage} alt="Source" className="max-w-full max-h-40 object-contain" />
            ) : (
              <span className="text-fg/50 text-sm">-</span>
            )}
          </div>
        </div>

        {/* Pass 1: Detection image */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Pass 1 {pass1Info && `(${pass1Info})`}</h3>
          <div className="border border-line bg-black h-40 flex items-center justify-center">
            {detectImageUrl ? (
              <img src={detectImageUrl} alt="Detect" className="max-w-full max-h-40 object-contain" />
            ) : (
              <span className="text-fg/50 text-sm">-</span>
            )}
          </div>
          {detectedLabel && <div className="text-xs text-fg/50 mt-1 font-mono break-all">{detectedLabel}</div>}
        </div>

        {/* Pass 2: Cropped & scaled */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Pass 2: Crop ({scale}%)</h3>
          <div className="border border-line bg-black h-40 flex items-center justify-center">
            {canvasDataUrl ? (
              <img src={canvasDataUrl} alt="Cropped" className="max-w-full max-h-40 object-contain" />
            ) : (
              <span className="text-fg/50 text-sm">-</span>
            )}
          </div>
          {cropInfo && <div className="text-xs text-fg/50 mt-1 font-mono break-all">{cropInfo}</div>}
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {/* Raw OCR text */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2">Raw OCR Text</h3>
        <pre className="p-2 bg-surface border border-line rounded font-mono text-xs whitespace-pre-wrap max-h-32 overflow-auto">
          {ocrResult || '-'}
        </pre>
      </div>
    </div>
  );
}
