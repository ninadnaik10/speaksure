import React, { useState, useEffect } from "react";
import { apiUrl } from "../lib/api";
import {
  Users,
  ChevronRight,
  BarChart3,
  Clock,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  FileText,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Separator } from "../components/ui/separator";

// Type definitions
interface InterviewResponse {
  avg_prediction: number;
  numofwords: number;
  speech_rate_wpm: number;
  feedback: string;
  transcript: string;
  question: string;
}

// Common filler words to highlight
const FILLER_WORDS = [
  "um",
  "uh",
  "umm",
  "uhh",
  "er",
  "ah",
  "like",
  "you know",
  "i mean",
  "sort of",
  "kind of",
  "basically",
  "actually",
  "literally",
  "so",
  "well",
  "hmm",
  "okay",
  "right",
  "yeah",
];

interface InterviewData {
  _id: string;
  name: string;
  responses: InterviewResponse[];
}

interface ApiResponse {
  results: InterviewData[];
}

type ViewMode = "list" | "detail";

const InterviewerDashboard: React.FC = () => {
  const [interviews, setInterviews] = useState<InterviewData[]>([]);
  const [selectedInterview, setSelectedInterview] =
    useState<InterviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    fetchInterviews();
  }, []);

  const fetchInterviews = async (): Promise<void> => {
    try {
      const response = await fetch(apiUrl("get_results"));
      if (!response.ok) throw new Error("Failed to fetch interviews");
      const data: ApiResponse = await response.json();
      setInterviews(data.results || []);
    } catch (error) {
      console.error("Error fetching interviews:", error);
      setInterviews([]);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number): { bg: string; text: string } => {
    if (score >= 4) return { bg: "bg-green-500", text: "text-white" };
    if (score >= 3) return { bg: "bg-blue-500", text: "text-white" };
    if (score >= 2) return { bg: "bg-red-400", text: "text-white" }; // Light red for somewhat confident
    return { bg: "bg-red-700", text: "text-white" }; // Dark red for not confident
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 4) return "Very Confident";
    if (score >= 3) return "Confident";
    if (score >= 2) return "Somewhat Confident";
    return "Not Confident";
  };

  const calculateOverallScore = (responses: InterviewResponse[]): string => {
    if (!responses || responses.length === 0) return "0";
    const sum = responses.reduce((acc, r) => acc + (r.avg_prediction || 0), 0);
    return (sum / responses.length).toFixed(1);
  };

  const countFillerWords = (text: string): number => {
    if (!text) return 0;

    const pattern = new RegExp(`\\b(${FILLER_WORDS.join("|")})\\b`, "gi");
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  };

  const highlightFillerWords = (text: string): React.ReactElement => {
    if (!text) return <span>No transcript available</span>;

    // Create a regex pattern that matches filler words with word boundaries
    const pattern = new RegExp(`\\b(${FILLER_WORDS.join("|")})\\b`, "gi");

    const parts: React.ReactElement[] = [];
    let lastIndex = 0;
    let match;

    // Find all matches and split the text
    const regex = new RegExp(pattern);
    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, match.index)}
          </span>
        );
      }

      // Add the highlighted filler word
      parts.push(
        <span
          key={`filler-${match.index}`}
          className="bg-yellow-200 dark:bg-red-400 text-yellow-900 dark:text-white px-1 rounded"
          title="Filler word"
        >
          {match[0]}
        </span>
      );

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>
      );
    }

    return <>{parts}</>;
  };

  const renderInterviewList = (): React.ReactElement => (
    <div className="min-h-screen p-6 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Interview Dashboard</h1>
          <p className="text-muted-foreground">
            Review and analyze candidate responses
          </p>
        </div>

        {loading ? (
          <Card className="p-12 text-center">
            <CardContent>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
              <p className="mt-4 text-muted-foreground">
                Loading interviews...
              </p>
            </CardContent>
          </Card>
        ) : interviews.length === 0 ? (
          <Card className="p-12 text-center">
            <CardContent>
              <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                No Interviews Found
              </h3>
              <p className="text-muted-foreground">
                There are no completed interviews to review yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {interviews.map((interview: InterviewData) => {
              const overallScore = calculateOverallScore(interview.responses);
              const totalQuestions = interview.responses?.length || 0;
              const totalWords =
                interview.responses?.reduce(
                  (sum, r) => sum + (r.numofwords || 0),
                  0
                ) || 0;
              const hasFeedback = interview.responses?.some(
                (r) => r.feedback && r.feedback.trim().length > 0
              );

              return (
                <Card
                  key={interview._id}
                  onClick={() => {
                    setSelectedInterview(interview);
                    setView("detail");
                  }}
                  className="cursor-pointer hover:shadow-lg transition-all group"
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                          <span className="text-2xl font-bold text-primary">
                            {interview.name?.charAt(0).toUpperCase() || "U"}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold">
                            {interview.name || "Unknown Candidate"}
                          </h3>
                          {/* <div className="flex items-center gap-2 text-muted-foreground text-sm mt-1">
                            <Calendar className="w-4 h-4" />
                            <span>{formatDate(interview.date)}</span>
                          </div> */}
                        </div>
                      </div>
                      <ChevronRight className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>

                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                            <TrendingUp className="w-4 h-4" />
                            <span>Overall Confidence Score</span>
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold">
                              {overallScore}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              / 5.0
                            </span>
                          </div>
                          <Badge
                            className={`mt-2 ${
                              getScoreColor(parseFloat(overallScore)).bg
                            } ${getScoreColor(parseFloat(overallScore)).text}`}
                          >
                            {getScoreLabel(parseFloat(overallScore))}
                          </Badge>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                            <MessageSquare className="w-4 h-4" />
                            <span>Questions</span>
                          </div>
                          <div className="text-3xl font-bold">
                            {totalQuestions}
                          </div>
                          <span className="text-sm text-muted-foreground">
                            answered
                          </span>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                            <FileText className="w-4 h-4" />
                            <span>Total Words</span>
                          </div>
                          <div className="text-3xl font-bold">{totalWords}</div>
                          <span className="text-sm text-muted-foreground">
                            spoken
                          </span>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                            <MessageSquare className="w-4 h-4" />
                            <span>AI Feedback</span>
                          </div>
                          <div className="text-3xl font-bold">
                            {hasFeedback ? "✓" : "—"}
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {hasFeedback ? "available" : "pending"}
                          </span>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="flex gap-2">
                      {interview.responses?.slice(0, 3).map((response, idx) => (
                        <div
                          key={idx}
                          className="flex-1 h-2 rounded-full bg-primary"
                          style={{
                            opacity: response.avg_prediction / 5,
                          }}
                        />
                      ))}
                      {interview.responses?.length > 3 && (
                        <span className="text-sm text-muted-foreground">
                          +{interview.responses.length - 3}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderInterviewDetail = (): React.ReactElement | null => {
    if (!selectedInterview) return null;

    const overallScore = calculateOverallScore(selectedInterview.responses);
    const avgFillerWordsPerResponse =
      selectedInterview.responses?.length > 0
        ? Math.round(
            selectedInterview.responses.reduce(
              (sum, r) => sum + countFillerWords(r.transcript || ""),
              0
            ) / selectedInterview.responses.length
          )
        : 0;
    const avgSpeechRate =
      selectedInterview.responses?.length > 0
        ? (
            selectedInterview.responses.reduce(
              (sum, r) => sum + (r.speech_rate_wpm || 0),
              0
            ) / selectedInterview.responses.length
          ).toFixed(1)
        : 0;

    return (
      <div className="min-h-screen p-6 bg-background">
        <div className="max-w-7xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setView("list")}
            className="mb-6"
          >
            <ChevronRight className="w-5 h-5 rotate-180 mr-2" />
            Back to Interviews
          </Button>

          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 bg-background/20 rounded-full flex items-center justify-center">
                    <span className="text-4xl font-bold">
                      {selectedInterview.name?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </div>
                  <div>
                    <CardTitle className="text-3xl mb-2">
                      {selectedInterview.name || "Unknown Candidate"}
                    </CardTitle>
                    {/* <div className="flex items-center gap-2 opacity-90">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(selectedInterview.date)}</span>
                    </div> */}
                  </div>
                </div>
                <div className="text-right">
                  <div className="opacity-90 text-sm mb-1">
                    Overall Confidence Score
                  </div>
                  <div className="text-5xl font-bold">{overallScore}</div>
                  <div className="opacity-90 text-sm">out of 5.0</div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-8">
              <div className="grid md:grid-cols-3 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-primary" />
                      </div>
                      <span className="font-medium">
                        Avg Filler Words/Response
                      </span>
                    </div>
                    <div className="text-3xl font-bold">
                      {avgFillerWordsPerResponse}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Clock className="w-5 h-5 text-primary" />
                      </div>
                      <span className="font-medium">Avg Speech Rate</span>
                    </div>
                    <div className="text-3xl font-bold">{avgSpeechRate}</div>
                    <div className="text-sm text-muted-foreground">
                      words per minute
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <BarChart3 className="w-5 h-5 text-primary" />
                      </div>
                      <span className="font-medium">Total Responses</span>
                    </div>
                    <div className="text-3xl font-bold">
                      {selectedInterview.responses?.length || 0}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {selectedInterview.responses?.map((response, idx) => (
              <Card key={idx}>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge>Question {idx + 1}</Badge>
                        {/* <Badge
                          variant={getScoreBadgeVariant(
                            response.avg_prediction
                          )}
                        > */}
                        {/* Confidence score:{" "}
                          {response.avg_prediction?.toFixed(1) || "N/A"} */}
                        {/* </Badge> */}
                      </div>
                      <CardTitle className="text-xl">
                        {response.question}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-2">
                      Transcript
                    </h4>
                    <p className="text-lg leading-relaxed">
                      {highlightFillerWords(response.transcript)}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-4 gap-4 mb-6">
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground mb-1">
                          Confidence Score
                        </div>
                        <div className="text-2xl font-bold">
                          {response.avg_prediction?.toFixed(1) || "0.0"}
                        </div>
                        <Badge
                          className={`mt-2 ${
                            getScoreColor(response.avg_prediction).bg
                          } ${getScoreColor(response.avg_prediction).text}`}
                        >
                          {getScoreLabel(response.avg_prediction)}
                        </Badge>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground mb-1">
                          Speech Rate
                        </div>
                        <div className="text-2xl font-bold">
                          {response.speech_rate_wpm?.toFixed(1) || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">WPM</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground mb-1">
                          Words Spoken
                        </div>
                        <div className="text-2xl font-bold">
                          {response.numofwords || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          words
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground mb-1">
                          Filler Words
                        </div>
                        <div className="text-2xl font-bold">
                          {countFillerWords(response.transcript || "")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          detected
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {response.feedback && response.feedback.trim().length > 0 ? (
                    <Alert>
                      <MessageSquare className="h-4 w-4" />
                      <AlertTitle>AI Feedback</AlertTitle>
                      <AlertDescription>
                        <div className="mt-2 space-y-2">
                          {response.feedback
                            .split("\n")
                            .filter((line) => line.trim())
                            .map((line, lineIdx) => (
                              <div
                                key={lineIdx}
                                className="flex items-start gap-2"
                              >
                                <span className="mt-1">•</span>
                                <span className="flex-1">
                                  {line.replace(/^\*\s*/, "").trim()}
                                </span>
                              </div>
                            ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert>
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>
                        No feedback available yet.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return view === "list" ? renderInterviewList() : renderInterviewDetail();
};

export default InterviewerDashboard;
