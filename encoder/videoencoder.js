const ffmpeg = require("fluent-ffmpeg");
const { Readable, PassThrough } = require("stream");
const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const fs = require("fs");

class VideoEncoder {
  constructor() {
    // this.qualityPresets = {
    //   low: {
    //     resolution: "640x360",
    //     videoBitrate: "800k",
    //     audioBitrate: "96k",
    //     fps: 24,
    //   },
    //   medium: {
    //     resolution: "1280x720",
    //     videoBitrate: "2500k",
    //     audioBitrate: "128k",
    //     fps: 30,
    //   },
    //   high: {
    //     resolution: "1920x1080",
    //     videoBitrate: "5000k",
    //     audioBitrate: "192k",
    //     fps: 30,
    //   },
    // };
    this.qualityPresets = {
      "360p": {
        resolution: "640x360",
        videoBitrate: "750k",
        audioBitrate: "96k",
        fps: 30,
      },
      "480p": {
        resolution: "854x480",
        videoBitrate: "1000k",
        audioBitrate: "128k",
        fps: 30,
      },
      "720p": {
        resolution: "1280x720",
        videoBitrate: "5000k",
        audioBitrate: "384k",
        fps: 30,
      },
      "720p60": {
        resolution: "1280x720",
        videoBitrate: "7500k",
        audioBitrate: "384k",
        fps: 60,
      },
      "1080p": {
        resolution: "1920x1080",
        videoBitrate: "8000k",
        audioBitrate: "384k",
        fps: 30,
      },
      "1080p60": {
        resolution: "1920x1080",
        videoBitrate: "12000k",
        audioBitrate: "384k",
        fps: 60,
      },
    };
  }

  async encodeGridFSVideo(gridFSBucket, filename, quality = "medium") {
    const preset = this.qualityPresets[quality];
    if (!preset) {
      throw new Error(`Invalid quality preset: ${quality}`);
    }

    // Create a temporary file for processing
    const tempInputPath = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputPath = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);

    try {
      // Download the file from GridFS to temp storage
      await this.downloadToTemp(gridFSBucket, filename, tempInputPath);

      // Process the video
      await this.processVideo(tempInputPath, tempOutputPath, preset);

      // Create a read stream from the processed file
      const outputStream = fs.createReadStream(tempOutputPath);

      // Clean up temp files when the stream ends
      outputStream.on("end", () => {
        this.cleanupTempFiles([tempInputPath, tempOutputPath]);
      });

      return outputStream;
    } catch (error) {
      this.cleanupTempFiles([tempInputPath, tempOutputPath]);
      throw error;
    }
  }

  async downloadToTemp(gridFSBucket, filename, tempPath) {
    return new Promise((resolve, reject) => {
      const downloadStream = gridFSBucket.openDownloadStreamByName(filename);
      const writeStream = fs.createWriteStream(tempPath);

      downloadStream
        .pipe(writeStream)
        .on("error", (error) => {
          console.error("Download error:", error);
          reject(error);
        })
        .on("finish", resolve);
    });
  }

  async processVideo(inputPath, outputPath, preset) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .size(preset.resolution)
        .videoBitrate(preset.videoBitrate)
        .audioBitrate(preset.audioBitrate)
        .fps(preset.fps)
        .addOptions([
          "-c:v libx264",
          "-preset medium",
          "-profile:v main",
          "-movflags +faststart",
          "-c:a aac",
          "-strict experimental",
        ])
        .format("mp4")
        .on("start", (commandLine) => {
          console.log("FFmpeg processing started:", commandLine);
        })
        .on("progress", (progress) => {
          console.log("Processing: " + progress.percent + "% done");
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          reject(err);
        })
        .on("end", () => {
          console.log("FFmpeg processing finished");
          resolve();
        })
        .save(outputPath);
    });
  }

  cleanupTempFiles(files) {
    files.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlink(file, (err) => {
          if (err) console.error(`Error deleting temp file ${file}:`, err);
        });
      }
    });
  }

  async getGridFSVideoInfo(gridFSBucket, fileName) {
    const tempFilePath = path.join(os.tmpdir(), `probe-${Date.now()}.mp4`);

    try {
      await this.downloadToTemp(gridFSBucket, fileName, tempFilePath);

      return await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });
    } finally {
      this.cleanupTempFiles([tempFilePath]);
    }
  }
}

class VideoEncodingService {
  async processVideo(metadata, bucket) {
    const encoder = new VideoEncoder();
    const filename = `recording_${metadata.recordingId}.mp4`;

    try {
      const videoInfo = await encoder.getGridFSVideoInfo(bucket, filename);
      console.log("Processing video:", videoInfo);

      // const qualities = ["low", "medium"];
      const qualities = ["480p", "720p"];

      for (const quality of qualities) {
        const encodedStream = await encoder.encodeGridFSVideo(
          bucket,
          filename,
          quality,
        );

        const uploadStream = bucket.openUploadStream(`${filename}_${quality}`, {
          metadata: {
            ...metadata,
            quality,
            status: "encoded",
          },
        });

        console.log(`Saving ${quality} quality to GridFS`);

        await new Promise((resolve, reject) => {
          encodedStream
            .pipe(uploadStream)
            .on("error", (error) => {
              console.error(`Error uploading ${quality} quality:`, error);
              reject(error);
            })
            .on("finish", () => {
              console.log(`Finished uploading ${quality} quality`);
              resolve();
            });
        });

        console.log(`Saved ${quality} quality version to GridFS`);
      }
    } catch (error) {
      console.error("Error processing video:", error);
      throw error;
    }
  }
}

module.exports = { VideoEncodingService };
