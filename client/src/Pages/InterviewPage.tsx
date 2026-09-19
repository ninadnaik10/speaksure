import React, { useState, useRef, useEffect } from "react";
import { apiUrl } from "../lib/api";
import { Camera, Mic, Square, Send, CheckCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription } from "../components/ui/alert";

// Type definitions
interface RecordedAnswer {
  question: string;
  answer: any;
  audioBlob: Blob;
}

type Stage = "welcome" | "setup" | "interview" | "complete";

const BehavioralInterview: React.FC = () => {
  const [stage, setStage] = useState<Stage>("welcome");
  const [currentQuestion, setCurrentQuestion] = useState<number>(0);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordedAnswers, setRecordedAnswers] = useState<RecordedAnswer[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [recordedMimeType, setRecordedMimeType] = useState<string>("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [name, setName] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sample behavioral questions
  const questions: string[] = [
    "Describe a situation where you showed leadership skills.",
    "Give an example of a goal you set and how you achieved it.",
  ];

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  useEffect(() => {
    if (stream && videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = stream;
    }
    visualizeAudio();
  }, [stream, stage]);

  const startCamera = async (): Promise<void> => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setPermissionGranted(true);

      // Setup audio visualization
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);
      analyser.fftSize = 256;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      setInterviewId(crypto.randomUUID());
      visualizeAudio();
    } catch (err) {
      console.error("Error accessing media devices:", err);
      alert("Unable to access camera/microphone. Please grant permissions.");
    }
  };

  const visualizeAudio = (): void => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = (): void => {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      // ctx.fillStyle = "hsl(var(--background))";
      ctx.fillStyle = "rgb(2, 6, 23)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight: number;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        ctx.fillStyle = "hsl(141, 71%, 48%)";
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  };

  const startRecording = (): void => {
    if (!stream) return;
    setRecordedChunks([]);

    let mimeType = "";
    const possibleTypes = ["video/webm"];

    for (const type of possibleTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    const options = mimeType ? { mimeType } : {};
    const recorder = new MediaRecorder(stream, options);

    setRecordedMimeType(recorder.mimeType);

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        setRecordedChunks((prev) => [...prev, e.data]);
      }
    };

    recorder.start();
    setMediaRecorder(recorder);
    setIsRecording(true);
  };

  const stopRecording = (): void => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const submitAnswer = async (): Promise<void> => {
    if (recordedChunks.length === 0) {
      alert("Please record an answer before submitting.");
      return;
    }

    setIsSubmitting(true);

    const mimeType = recordedMimeType || "audio/webm";
    const blob = new Blob(recordedChunks, { type: mimeType });

    let extension = "webm";
    if (mimeType.includes("mp4")) extension = "mp4";
    else if (mimeType.includes("ogg")) extension = "ogg";
    else if (mimeType.includes("mpeg")) extension = "mp3";
    else if (mimeType.includes("wav")) extension = "wav";

    const formData = new FormData();
    formData.append(
      "audio",
      blob,
      `answer_${currentQuestion + 1}.${extension}`
    );
    formData.append("interview_id", interviewId);
    formData.append("name", name);
    formData.append("question", questions[currentQuestion]);

    try {
      const response = await fetch(apiUrl("predict"), {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to analyze answer");

      const result = await response.json();

      setRecordedAnswers((prev) => [
        ...prev,
        {
          question: questions[currentQuestion],
          answer: result,
          audioBlob: blob,
        },
      ]);

      setRecordedChunks([]);

      if (currentQuestion < questions.length - 1) {
        setCurrentQuestion((prev) => prev + 1);
      } else {
        setStage("complete");
      }
    } catch (err) {
      console.error("Error submitting answer:", err);
      alert("Failed to submit answer. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const skipQuestion = (): void => {
    setRecordedChunks([]);
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      setStage("complete");
    }
  };

  return (
    <>
      {stage === "welcome" && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <Card className="max-w-2xl w-full">
            <CardHeader className="text-center space-y-4">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Camera className="w-10 h-10 text-primary" />
              </div>
              <CardTitle className="text-4xl">Behavioral Interview</CardTitle>
              <CardDescription className="text-lg">
                Welcome! This interview consists of {questions.length}{" "}
                behavioral questions. You'll record your answers using your
                camera and microphone.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Before you begin:</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    <li className="flex items-start">
                      <span className="text-primary mr-2">•</span>
                      <span>
                        Ensure you're in a quiet, well-lit environment
                      </span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-primary mr-2">•</span>
                      <span>
                        Grant camera and microphone permissions when prompted
                      </span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-primary mr-2">•</span>
                      <span>Take your time to think before answering</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-primary mr-2">•</span>
                      <span>Speak clearly and provide specific examples</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Input
                  type="text"
                  placeholder="Enter your Name"
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setName(e.target.value)
                  }
                />

                <Button
                  onClick={() => setStage("setup")}
                  className="w-full"
                  size="lg"
                  disabled={!name.trim()}
                >
                  Start Interview
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {stage === "setup" && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <Card className="max-w-4xl w-full">
            <CardHeader>
              <CardTitle className="text-3xl text-center">
                Camera & Audio Setup
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />
                {!permissionGranted && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <div className="text-center text-muted-foreground">
                      <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg">Camera preview will appear here</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="h-20 bg-muted rounded-lg overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width="800"
                  height="80"
                  className="w-full h-full"
                />
              </div>

              <div className="flex gap-4 justify-center">
                {!permissionGranted ? (
                  <Button onClick={startCamera} size="lg">
                    <Camera className="w-5 h-5 mr-2" />
                    Enable Camera & Microphone
                  </Button>
                ) : (
                  <Button onClick={() => setStage("interview")} size="lg">
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Continue to Interview
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {stage === "interview" && (
        <div className="min-h-screen p-6 bg-background">
          <div className="max-w-6xl mx-auto">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-2xl">
                    Question {currentQuestion + 1} of {questions.length}
                  </CardTitle>
                  <Badge variant="secondary">
                    {recordedAnswers.length} answered
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="h-24 bg-muted rounded-lg overflow-hidden">
                      <canvas
                        ref={canvasRef}
                        width="800"
                        height="96"
                        className="w-full h-full"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <Card className="mb-4 flex-grow">
                      <CardHeader>
                        <CardDescription className="text-xs font-semibold uppercase">
                          Your Question
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xl leading-relaxed">
                          {questions[currentQuestion]}
                        </p>
                      </CardContent>
                    </Card>

                    <div className="space-y-3">
                      {!isRecording ? (
                        <Button
                          onClick={startRecording}
                          disabled={isSubmitting}
                          variant="destructive"
                          className="w-full"
                          size="lg"
                        >
                          <Mic className="w-5 h-5 mr-2" />
                          Start Recording Answer
                        </Button>
                      ) : (
                        <Button
                          onClick={stopRecording}
                          variant="secondary"
                          className="w-full animate-pulse"
                          size="lg"
                        >
                          <Square className="w-5 h-5 mr-2" />
                          Stop Recording
                        </Button>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          onClick={submitAnswer}
                          disabled={recordedChunks.length === 0 || isSubmitting}
                          size="lg"
                        >
                          {isSubmitting ? (
                            "Processing..."
                          ) : (
                            <>
                              <Send className="w-5 h-5 mr-2" />
                              Submit Answer
                            </>
                          )}
                        </Button>

                        <Button
                          onClick={skipQuestion}
                          disabled={isSubmitting}
                          variant="outline"
                          size="lg"
                        >
                          Skip Question
                        </Button>
                      </div>

                      {recordedChunks.length > 0 && !isRecording && (
                        <Alert>
                          <CheckCircle className="h-4 w-4" />
                          <AlertDescription>
                            Answer recorded! Ready to submit.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {stage === "complete" && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <Card className="max-w-3xl w-full">
            <CardHeader className="text-center space-y-4">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-10 h-10 text-primary" />
              </div>
              <CardTitle className="text-4xl">Interview Complete!</CardTitle>
              <CardDescription className="text-lg">
                Thank you for completing the behavioral interview. Your
                responses have been recorded and analyzed.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-center">
                    Interview Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary">
                        {recordedAnswers.length}
                      </div>
                      <div className="text-muted-foreground">
                        Questions Answered
                      </div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-primary">
                        {questions.length}
                      </div>
                      <div className="text-muted-foreground">
                        Total Questions
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={() => {
                  setStage("welcome");
                  setCurrentQuestion(0);
                  setRecordedAnswers([]);
                  setRecordedChunks([]);
                  if (stream) {
                    stream.getTracks().forEach((track) => track.stop());
                    setStream(null);
                  }
                  setPermissionGranted(false);
                }}
                className="w-full"
                size="lg"
              >
                Start New Interview
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
};

export default BehavioralInterview;
