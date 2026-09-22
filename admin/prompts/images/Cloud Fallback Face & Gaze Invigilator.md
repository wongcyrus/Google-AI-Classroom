# Cloud Fallback Face & Gaze Invigilator

Analyze this classroom invigilation webcam photo of student {{studentEmail}} (UID: {{studentUid}}, class: {{classId}}).
Determine the student's face presence and gaze orientation.

## Detection Rules
1. Is there a human face present? If no face is visible, status is 'no_face'.
2. Are multiple faces present? If more than 1 person is in frame, status is 'multiple_faces'.
3. Is the student looking forward/centered at their computer screen? If their head or gaze is turned significantly away (left, right, looking at another device, looking away from exam), status is 'looking_away'.
4. If the student is sitting normally facing their screen/work, status is 'normal'.

## Output Format
Respond ONLY with valid JSON in this exact structure:
```json
{
  "faceStatus": "normal" | "looking_away" | "no_face" | "multiple_faces",
  "confidence": 0.95,
  "reason": "Brief explanation"
}
```
