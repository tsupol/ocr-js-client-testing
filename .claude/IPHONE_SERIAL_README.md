# iPhone Serial/IMEI Scanner - Development Notes

## Goal
Scan iPhone Settings > General > About screen to extract Serial Number and IMEI using webcam + Tesseract.js OCR.

## Current Architecture

### Detection Flow
1. **Blur check** (fastest) - Laplacian variance on low-res frame, skip if blurry
2. **Fast detection** - Low-res OCR to find "Serial" or "IMEI" label position (bbox)
3. **Crop + Scale** - Crop area around label, scale up 4x for better OCR
4. **Extract** - Run OCR on scaled crop, extract serial/IMEI patterns
5. **Validate** - Need 3+ identical reads to confirm a value

### Key Files
- `IPhoneSerialPage.tsx` - Main scanner page
- `OcrDebugPage.tsx` - Debug page for testing OCR with different scales/settings

### What Works
- IMEI detection works well
- Blur detection works
- Label position detection works

### Current Issues (TODO)
1. **Crop area is bad** - Need to fix the crop coordinates for serial
2. **Serial OCR accuracy** - OCR misreads characters (J→I, 0→Q)
   - Solution: Scale up 4x helps (tested in debug page at 400%)
   - Future: Could post-process to replace I→1, O→0 (Apple never uses I/O in serials)
3. **Candidate logic** - Candidates not accumulating properly, never reaches 3 to confirm

### Apple Serial Number Facts
- Length: 10-15 characters (alphanumeric)
- Never contains letters O or I (uses 0 and 1 instead)
- Pattern: `/[A-Z0-9]{10,15}/`

### Debug UI Shows
- Sharpness meter (blur score)
- Confidence meter
- Last OCR text → Extracted values
- Candidate counts with occurrences (e.g., `FTJHR20GPY:2`)
- Crop preview (toggle "Show crop area")

### Resolution Settings
- Camera: 1280x720
- Low-res (blur/detection): 320px width
- Full-res extraction: 640px width
- OCR scale: 4x on cropped area
