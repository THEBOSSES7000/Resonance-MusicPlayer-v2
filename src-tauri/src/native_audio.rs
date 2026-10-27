//! Reproducción nativa con seek rápido (symphonia) y hilo dedicado.
//! El stream de rodio/cpal NO es Send → vive en este hilo; comandos por canal.

use lofty::file::AudioFile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

use rodio::Source;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

mod types;
mod eq;
mod rate;
mod measuring;
mod decoder;
mod fade;
mod player;
pub(crate) mod commands;
pub(crate) mod waveform;

pub use types::*;
pub use eq::*;
pub use rate::*;
pub use measuring::*;
pub use decoder::*;
pub use fade::*;
pub use player::*;
pub use waveform::*;
