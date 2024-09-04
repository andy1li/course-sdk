import Course from "./models/course";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import child_process from "child_process";
import ShellCommandExecutor from "./shell-command-executor";
const { Transform } = require("stream");

export default class TesterDownloader {
  static DEFAULT_TESTERS_ROOT_DIR = "/tmp/testers";

  course: Course;
  testersRootDir: string;

  constructor(course: Course, testersRootDir?: string) {
    this.course = course;
    this.testersRootDir = testersRootDir || TesterDownloader.DEFAULT_TESTERS_ROOT_DIR;
  }

  static clearCache() {
    fs.rmSync(TesterDownloader.DEFAULT_TESTERS_ROOT_DIR, { recursive: true, force: true });
  }

  async downloadIfNeeded(): Promise<string> {
    if (await fs.promises.exists(this.testerDir)) {
      return this.testerDir;
    }

    const compressedFilePath = path.join(this.testersRootDir, `${this.course.slug}.tar.gz`);

    fs.mkdirSync(this.testersRootDir, { recursive: true });

    const fileStream = fs.createWriteStream(compressedFilePath);
    const latestVersion = await this.latestTesterVersion();
    const artifactUrl = `https://github.com/${this.testerRepositoryName}/releases/download/${latestVersion}/${latestVersion}_linux_amd64.tar.gz`;
    console.log(`Downloading ${artifactUrl}`);

    let i = 0;
    const limit = 32;

    const inspector = new Transform({
      transform(chunk, encoding, callback) {
        if (chunk.toString().length > 0) {
          i += 1;
        }
        if (i < limit) {
          console.log("Chunk length:", chunk.toString().length, " > ", chunk.toString().slice(0, 32));
        }
        callback(null, chunk); // Pass the chunk through unchanged
      },
    });

    const response = await fetch(artifactUrl);
    console.log("status code", response.status);
    response.body.pipe(inspector).pipe(fileStream);

    console.log("🎯 After fetch");

    await new Promise((resolve, reject) => {
      const logAndResolve = (msg: string) => () => {
        console.log(msg);
        resolve(msg);
      };

      const logAndReject = (msg: string) => () => {
        console.log(msg);
        reject(msg);
      };

      fileStream.on("finish", logAndResolve("finish"));
      fileStream.on("error", logAndReject("error"));
      fileStream.on("close", () => console.log("closed"));
      fileStream.on("drain", () => console.log("drained"));
      fileStream.on("pipe", () => console.log("piped"));
      fileStream.on("unpipe", () => console.log("unpiped"));
    });

    console.log("🎯 After fileStream");

    try {
      const tempExtractDir = fs.mkdtempSync("/tmp/extract");
      await ShellCommandExecutor.execute(`tar xf ${compressedFilePath} -C ${tempExtractDir}`);
      fs.unlinkSync(compressedFilePath);
      fs.renameSync("tempExtractDir", this.testerDir);
      console.log("testerDir", this.testerDir);
    } catch (error) {
      console.error("Error extracting tester", error);
      process.exit(1);
    }

    return this.testerDir;
  }

  async latestTesterVersion() {
    const response = await fetch(`https://api.github.com/repos/${this.testerRepositoryName}/releases/latest`, {
      headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch latest tester version. Status: ${response.status}. Response: ${await response.text()}`);
    }

    const tagName = (await response.json()).tag_name;

    if (!tagName) {
      throw new Error(`Failed to fetch latest tester version. No tag name found in response: ${await response.text()}`);
    }

    return tagName;
  }

  get testerDir() {
    return path.join(this.testersRootDir, this.course.slug);
  }

  get testerRepositoryName() {
    return `codecrafters-io/${this.course.slug}-tester`;
  }
}
