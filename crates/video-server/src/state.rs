use std::path::PathBuf;

use crate::transcoder::Transcoder;

#[derive(Clone)]
pub struct VideoServerState {
    pub transcoder: Transcoder,
    pub data_dir: PathBuf,
    pub output_dir: PathBuf,
}

impl VideoServerState {
    pub fn new(data_dir: PathBuf) -> Self {
        let ffmpeg_dir = data_dir.clone();
        let output_dir = data_dir.join("video_output");

        let transcoder = Transcoder::new(output_dir.clone(), &ffmpeg_dir)
            .expect("Failed to initialize transcoder");

        Self {
            transcoder,
            data_dir,
            output_dir,
        }
    }
}
