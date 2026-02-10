import { useState, useRef, useEffect } from 'react';
import Tesseract, { PSM, OEM } from 'tesseract.js';
import { Button, Select } from 'tsp-form';
import { Upload, Image as ImageIcon } from 'lucide-react';

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
  { value: 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', label: 'A-Z 0-9 (no I/O)' },
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);

  const [status, setStatus] = useState('Loading...');
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [scale, setScale] = useState('400');
  const [psm, setPsm] = useState(String(PSM.SINGLE_LINE));
  const [oem, setOem] = useState(String(OEM.LSTM_ONLY));
  const [langData, setLangData] = useState('best');
  const [whitelist, setWhitelist] = useState('');
  const [preprocess, setPreprocess] = useState('sharpen');
  const [ocrResult, setOcrResult] = useState<string>('');
  const [serialResult, setSerialResult] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [canvasDataUrl, setCanvasDataUrl] = useState<string>('');
  const [detectImageUrl, setDetectImageUrl] = useState<string>('');
  const [ocrTime, setOcrTime] = useState<number | null>(null);
  const [cropInfo, setCropInfo] = useState<string>('');
  const [detectedLabel, setDetectedLabel] = useState<string>('');
  const [srcInfo, setSrcInfo] = useState<string>('');
  const [pass1Info, setPass1Info] = useState<string>('');

  // Initialize/reinitialize worker when OEM or langData changes
  useEffect(() => {
    const init = async () => {
      if (workerRef.current) {
        await workerRef.current.terminate();
        workerRef.current = null;
      }

      const oemMode = parseInt(oem) as OEM;
      const oemLabel = oemOptions.find(o => o.value === oem)?.label || oem;
      const langLabel = langDataOptions.find(o => o.value === langData)?.label || langData;
      setStatus(`Loading OCR engine (${oemLabel}, ${langLabel})...`);

      const langPath = langData === 'fast'
        ? 'https://tessdata.projectnaptha.com/4.0.0_fast'
        : 'https://tessdata.projectnaptha.com/4.0.0_best';

      const worker = await Tesseract.createWorker('eng', oemMode, { langPath });
      workerRef.current = worker;
      setStatus('Ready - choose image source');
    };
    init();

    return () => {
      workerRef.current?.terminate();
    };
  }, [oem, langData]);

  const loadSampleImage = () => {
    setSourceImage(SAMPLE_IMAGE);
    setStatus('Sample image loaded');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setSourceImage(ev.target?.result as string);
      setStatus('Uploaded image loaded');
    };
    reader.readAsDataURL(file);
  };

  const runOcr = async () => {
    if (!workerRef.current || !sourceImage || !canvasRef.current) return;

    setProcessing(true);
    const startTime = performance.now();

    const img = new Image();
    img.src = sourceImage;
    await new Promise(resolve => img.onload = resolve);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    // === PASS 1: Detect label at reduced size for speed ===
    setSrcInfo(`${img.naturalWidth}x${img.naturalHeight}`);

    // Resize to max 1200px width for detection (balance speed vs accuracy)
    const DETECT_MAX_WIDTH = 1200;
    const detectScale = Math.min(1, DETECT_MAX_WIDTH / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * detectScale);
    canvas.height = Math.round(img.naturalHeight * detectScale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    setStatus(`Pass 1: Detecting label at ${Math.round(detectScale * 100)}%...`);
    setPass1Info(`${canvas.width}x${canvas.height}`);

    const fullImageData = canvas.toDataURL('image/png');
    setDetectImageUrl(fullImageData);

    await workerRef.current.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    const detectResult = await workerRef.current.recognize(fullImageData, {}, { blocks: true });

    // Extract words from blocks with their bboxes
    const allWords: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
    const allLines: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];

    if (detectResult.data.blocks) {
      for (const block of detectResult.data.blocks) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            allLines.push({ text: line.text, bbox: line.bbox });
            for (const word of line.words || []) {
              allWords.push({ text: word.text, bbox: word.bbox });
            }
          }
        }
      }
    }

    console.log('All words:', allWords.map(w => `"${w.text}" at ${w.bbox.x0},${w.bbox.y0}`));
    console.log('All lines:', allLines.map(l => `"${l.text}" at ${l.bbox.x0},${l.bbox.y0}`));

    // Find line containing "serial" - the line bbox spans the full width including the value
    const serialLine = allLines.find(l => l.text.toLowerCase().includes('serial'));

    setDetectedLabel(
      serialLine
        ? `Line: "${serialLine.text}" bbox: x0=${Math.round(serialLine.bbox.x0)} x1=${Math.round(serialLine.bbox.x1)} w=${Math.round(serialLine.bbox.x1 - serialLine.bbox.x0)}`
        : `Not found. Lines: ${allLines.map(l => l.text).join(' | ')}`
    );

    const labelBbox = serialLine?.bbox;

    if (!labelBbox) {
      const endTime = performance.now();
      setOcrTime(Math.round(endTime - startTime));
      setStatus('Could not find "Serial" label');
      setOcrResult(`Words: ${allWords.map(w => w.text).join(', ')}\nLines: ${allLines.map(l => l.text).join(' | ')}\n\n${detectResult.data.text}`);
      setSerialResult('Not found');
      setCanvasDataUrl('');
      setProcessing(false);
      return;
    }

    // === PASS 2: Crop region and scale up ===
    setStatus(`Pass 2: Cropping and scaling...`);

    // Scale bbox from detection size back to original image size
    const bboxScale = 1 / detectScale;
    const bbox = {
      x0: labelBbox.x0 * bboxScale,
      y0: labelBbox.y0 * bboxScale,
      x1: labelBbox.x1 * bboxScale,
      y1: labelBbox.y1 * bboxScale,
    };

    // The line bbox only covers "Serial Number" label
    // We need to extend to the right to capture the value
    const lineW = bbox.x1 - bbox.x0;
    const lineH = bbox.y1 - bbox.y0;
    const padding = lineH * 0.5;

    // Crop: start at label, extend to right edge of image to capture value
    const cropX = Math.max(0, bbox.x0 - padding);
    const cropY = Math.max(0, bbox.y0 - padding);
    const cropW = img.naturalWidth - cropX; // extend to right edge
    const cropH = lineH + padding * 2;

    // Scale to target height, but cap max dimensions
    const TARGET_HEIGHT = 600;
    const MAX_WIDTH = 2000;
    let ocrScale = Math.max(1, TARGET_HEIGHT / cropH);

    // Cap width if too large
    if (cropW * ocrScale > MAX_WIDTH) {
      ocrScale = MAX_WIDTH / cropW;
    }

    const finalW = Math.round(cropW * ocrScale);
    const finalH = Math.round(cropH * ocrScale);

    setCropInfo(`crop: ${Math.round(cropW)}x${Math.round(cropH)} → scaled: ${finalW}x${finalH}`);

    canvas.width = finalW;
    canvas.height = finalH;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    // Apply preprocessing
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

    // Set params for extraction - use SINGLE_LINE since we cropped one line
    await workerRef.current.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });

    console.log('Pass 2: OCR on cropped image', finalW, 'x', finalH);
    const extractResult = await workerRef.current.recognize(croppedImageData);
    const text = extractResult.data.text;
    console.log('Pass 2 result:', text);

    const endTime = performance.now();
    const elapsed = Math.round(endTime - startTime);
    setOcrTime(elapsed);

    // iOS format is "Label | Value" - extract value after separator
    let valueText = text;
    if (text.includes('|')) {
      valueText = text.split('|').pop()?.trim() || text;
    }

    // Find serial pattern in the value portion
    const matches = valueText.match(SERIAL_PATTERN);
    const serial = matches ? matches[0] : 'Not found';

    setOcrResult(`Full: ${text}\nValue: ${valueText}\nSerial: ${serial}`);
    setSerialResult(serial);
    setStatus(`Done - 2-pass OCR - ${elapsed}ms total`);
    setProcessing(false);
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-title font-semibold mb-4">Serial OCR Debug</h1>
      <p className="text-fg/60 mb-4 text-sm">
        Test OCR on serial number images. Pass 1 detects "Serial" label at 100%, Pass 2 crops and scales to 800px height for extraction.
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

      {/* Images row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Source image */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Source {srcInfo && `(${srcInfo})`}</h3>
          <div className="border border-line bg-black h-40 flex items-center justify-center">
            {sourceImage ? (
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
          <h3 className="text-sm font-semibold mb-2">Pass 2: Crop (800px h)</h3>
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
