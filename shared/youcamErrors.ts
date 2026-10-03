/**
 * Plain-language advice for YouCam engine and API error codes
 * (https://docs.perfectcorp.com/develop/error_codes and the per-API "File Specs & Errors" tables).
 */
export interface ErrorAdvice {
  title: string;
  advice: string;
  retake: boolean;
}

const ADVICE: Record<string, ErrorAdvice> = {
  error_src_face_too_small: { title: 'Face too small', advice: 'Move closer. Your face should fill most of the frame: more than 60% of the photo’s width.', retake: true },
  error_face_position_too_small: { title: 'Face too small', advice: 'Move closer so your face fills most of the frame.', retake: true },
  error_src_face_out_of_bound: { title: 'Face partly out of frame', advice: 'Centre your face and keep all of it inside the photo.', retake: true },
  error_face_position_out_of_boundary: { title: 'Face partly out of frame', advice: 'Centre your face and keep all of it inside the photo.', retake: true },
  error_face_position_invalid: { title: 'Face not fully visible', advice: 'Show your whole face, facing the camera, with nothing cut off.', retake: true },
  error_lighting_dark: { title: 'Too dark', advice: 'Face a window or a soft light so your face is evenly lit.', retake: true },
  error_insufficient_lighting: { title: 'Too dark', advice: 'Face a window or a soft light so your face is evenly lit.', retake: true },
  error_below_min_image_size: { title: 'Photo too small', advice: 'Use a photo at least 480 px on its short side (1080 px for HD).', retake: true },
  error_exceed_max_image_size: { title: 'Photo too large', advice: 'Use a smaller photo (under 4096 px on its long side).', retake: true },
  exceed_max_filesize: { title: 'File too large', advice: 'Use a photo under 10 MB.', retake: true },
  error_no_face: { title: 'No face found', advice: 'Take a front-facing photo of one face, without glasses or hair over the forehead.', retake: true },
  error_pose: { title: 'Pose not recognised', advice: 'Look straight at the camera with a neutral expression.', retake: true },
  error_large_face_angle: { title: 'Head is turned', advice: 'Look straight at the camera and keep your head level.', retake: true },
  error_face_angle_invalid: { title: 'Head is turned', advice: 'Keep your head within about 10° of straight on.', retake: true },
  error_face_parsing: { title: 'Couldn’t read the face', advice: 'Remove glasses, push hair back and try again in even light.', retake: true },
  error_multiple_people: { title: 'More than one person', advice: 'Use a photo with only you in it.', retake: true },
  error_nsfw_content_detected: { title: 'Photo rejected', advice: 'The photo was rejected by YouCam’s content filter. Use a plain head-and-shoulders selfie.', retake: true },
  error_decode_image: { title: 'Unreadable image', advice: 'Use a JPG or PNG photo.', retake: true },
  error_download_image: { title: 'Upload problem', advice: 'The photo didn’t reach YouCam. Please try again.', retake: false },
  error_inference: { title: 'Analysis failed', advice: 'YouCam couldn’t finish this one. Try again in a minute. No units were charged.', retake: false },
  unknown_internal_error: { title: 'Analysis failed', advice: 'YouCam had an internal error. Try again. No units were charged.', retake: false },
  CreditInsufficiency: { title: 'Out of YouCam units', advice: 'The YouCam account has run out of units.', retake: false },
  InvalidParameters: { title: 'Request rejected', advice: 'YouCam rejected the request parameters. This is a bug, please report it.', retake: false },
  InvalidAccessToken: { title: 'API key rejected', advice: 'The YouCam API key is missing or invalid. Run scripts/set-youcam-key.sh.', retake: false },
  RateLimited: { title: 'Busy', advice: 'Too many requests in the last few minutes. Wait a moment and try again.', retake: false },
  TaskTimeout: { title: 'Took too long', advice: 'The analysis timed out. Try again. No units were charged.', retake: false },
  PollTimeout: {
    title: 'Took too long',
    advice: 'YouCam had not finished after 3 minutes, so Unstack stopped waiting. The unit ledger counts it as spent in case YouCam bills it later.',
    retake: false,
  },
  YouCamUnreachable: { title: 'YouCam not reachable', advice: 'The YouCam API did not answer. Check the connection and try again in a minute.', retake: false },
  error_upload: { title: 'Upload problem', advice: 'The photo didn’t reach YouCam storage. Please try again.', retake: false },
};

export function adviceFor(code: string | null | undefined): ErrorAdvice {
  return (code && ADVICE[code]) || { title: 'Something went wrong', advice: 'Please try again in a moment.', retake: false };
}
