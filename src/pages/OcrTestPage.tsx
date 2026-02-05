import { useState } from 'react';
import Tesseract from 'tesseract.js';
import { Button, Select, ProgressBar } from 'tsp-form';

const imageFiles = import.meta.glob('/public/test-cid-cards/*.(jpg|jpeg|png|gif|webp)', { eager: true, as: 'url' });

const testImages = Object.entries(imageFiles).map(([path, url]) => {
  const filename = path.split('/').pop() || path;
  return { value: url as string, label: filename };
});

export function OcrTestPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(testImages[0]?.value || null);
  const [ocrResult, setOcrResult] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const runOcr = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    setOcrResult('');
    setProgress(0);

    try {
      const result = await Tesseract.recognize(
        selectedImage,
        'tha+eng',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              setProgress(Math.round(m.progress * 100));
            }
          },
        }
      );

      setOcrResult(result.data.text);
    } catch (error) {
      setOcrResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-title font-semibold mb-4">OCR Test - Thai ID Card</h1>

      <div className="mb-4">
        <label className="form-label block mb-2">Select Test Image</label>
        <Select
          options={testImages}
          value={selectedImage}
          onChange={(val) => setSelectedImage(val as string)}
          placeholder="Select an image"
        />
      </div>

      {selectedImage && (
        <div className="mb-4">
          <img
            src={selectedImage}
            alt="Test ID Card"
            className="max-w-full h-auto border border-line rounded-lg"
          />
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <Button
          onClick={runOcr}
          disabled={isProcessing || !selectedImage}
          color="primary"
        >
          {isProcessing ? 'Processing...' : 'Run OCR'}
        </Button>
      </div>

      {isProcessing && (
        <div className="mb-4">
          <ProgressBar
            value={progress}
            showLabel
            color="primary"
            striped
            animated
          />
        </div>
      )}

      {ocrResult && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">Extracted Text:</h2>
          <pre className="p-4 bg-surface border border-line rounded-lg whitespace-pre-wrap text-sm">
            {ocrResult}
          </pre>
        </div>
      )}
    </div>
  );
}
