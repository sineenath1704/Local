import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  TextInput,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Animated,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import { useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  XMarkIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  MapPinIcon,
  StarIcon as StarOutline,
  HeartIcon as HeartOutline,
  PhotoIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "react-native-heroicons/outline";
import { StarIcon as StarSolid, HeartIcon as HeartSolid } from "react-native-heroicons/solid";

import {
  getPostCommentData,
  resolveCommentImage,
  countComments,
  countReviews,
  makeLocalComment,
  makeLocalReply,
  CommentItem,
  CommentReply,
  ReviewItem,
  AiSummary,
} from "../data/commentsData";
import { fetchAiSummary } from "../services/aiSummaryService";
import { asAiError, type AiError } from "../services/aiHttp";
import { useAiPlanner } from "../state/AiPlannerContext";

type TabKey = "comments" | "reviews" | "ai";

interface CommentSheetProps {
  visible: boolean;
  postId: string;
  onClose: () => void;
}

/** Round avatar — shows the person's image, or a letter fallback circle. */
function Avatar({
  avatarKey,
  name,
  size = 40,
}: {
  avatarKey?: string;
  name: string;
  size?: number;
}) {
  const img = resolveCommentImage(avatarKey);
  if (img) {
    return (
      <Image
        source={img}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="bg-emerald-100 items-center justify-center"
    >
      <Text className="text-[#2D6A4F] font-bold" style={{ fontSize: size * 0.4 }}>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((i) =>
        i <= rating ? (
          <StarSolid key={i} size={size} color="#F59E0B" />
        ) : (
          <StarOutline key={i} size={size} color="#D1D5DB" />
        )
      )}
    </View>
  );
}

// ---------- Comment row (with likes + replies) ----------
function CommentRow({
  comment,
  onReply,
}: {
  comment: CommentItem;
  onReply: (commentId: string, replyingToName: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(comment.likes);
  const [showReplies, setShowReplies] = useState(true);

  const toggleLike = () => {
    setLiked((p) => {
      setLikes((n) => (p ? n - 1 : n + 1));
      return !p;
    });
  };

  return (
    <View className="px-4 py-3">
      <View className="flex-row">
        <Avatar avatarKey={comment.avatarKey} name={comment.authorName} size={40} />
        <View className="flex-1 ml-3">
          <Text className="text-gray-900 font-bold text-[13px]">
            {comment.authorName}
          </Text>
          <Text className="text-gray-800 text-[13px] leading-5 mt-0.5">
            {comment.text}
          </Text>
          <View className="flex-row items-center mt-1.5">
            <Text className="text-gray-400 text-[11px]">{comment.timeAgo}</Text>
            <TouchableOpacity
              onPress={() => onReply(comment.id, comment.authorName)}
              activeOpacity={0.6}
              className="ml-4"
            >
              <Text className="text-gray-500 text-[11px] font-semibold">ตอบกลับ</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Like column */}
        <TouchableOpacity onPress={toggleLike} activeOpacity={0.6} className="items-center ml-2 pt-1">
          {liked ? (
            <HeartSolid size={16} color="#EF4444" />
          ) : (
            <HeartOutline size={16} color="#9CA3AF" />
          )}
          {likes > 0 && (
            <Text className="text-gray-400 text-[10px] mt-0.5">{likes}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Replies (indented) */}
      {comment.replies.length > 0 && (
        <View className="ml-12 mt-2">
          {!showReplies ? (
            <TouchableOpacity onPress={() => setShowReplies(true)} activeOpacity={0.6}>
              <Text className="text-[#2D6A4F] text-[11px] font-semibold">
                ดูการตอบกลับ {comment.replies.length} รายการ
              </Text>
            </TouchableOpacity>
          ) : (
            comment.replies.map((reply) => (
              <ReplyRow key={reply.id} reply={reply} onReply={() => onReply(comment.id, reply.authorName)} />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ReplyRow({ reply, onReply }: { reply: CommentReply; onReply: () => void }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(reply.likes);
  const toggleLike = () => {
    setLiked((p) => {
      setLikes((n) => (p ? n - 1 : n + 1));
      return !p;
    });
  };
  return (
    <View className="flex-row mb-2.5">
      <Avatar avatarKey={reply.avatarKey} name={reply.authorName} size={30} />
      <View className="flex-1 ml-2.5">
        <Text className="text-gray-900 font-bold text-[12px]">{reply.authorName}</Text>
        <Text className="text-gray-800 text-[12px] leading-5 mt-0.5">{reply.text}</Text>
        <View className="flex-row items-center mt-1">
          <Text className="text-gray-400 text-[10px]">{reply.timeAgo}</Text>
          <TouchableOpacity onPress={onReply} activeOpacity={0.6} className="ml-4">
            <Text className="text-gray-500 text-[10px] font-semibold">ตอบกลับ</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity onPress={toggleLike} activeOpacity={0.6} className="items-center ml-2 pt-1">
        {liked ? <HeartSolid size={13} color="#EF4444" /> : <HeartOutline size={13} color="#9CA3AF" />}
        {likes > 0 && <Text className="text-gray-400 text-[9px] mt-0.5">{likes}</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ---------- Review row ----------
function ReviewRow({ review }: { review: ReviewItem }) {
  const images = review.imageKeys
    .map((k) => resolveCommentImage(k))
    .filter((x): x is any => x != null);
  return (
    <View className="px-4 py-3 border-b border-gray-100">
      <View className="flex-row items-center">
        <Avatar avatarKey={review.avatarKey} name={review.authorName} size={40} />
        <View className="flex-1 ml-3">
          <Text className="text-gray-900 font-bold text-[13px]">{review.authorName}</Text>
          <View className="flex-row items-center mt-0.5">
            <StarRating rating={review.rating} />
            <Text className="text-gray-400 text-[11px] ml-2">{review.timeAgo}</Text>
          </View>
        </View>
      </View>

      {review.text.trim().length > 0 && (
        <Text className="text-gray-800 text-[13px] leading-5 mt-2.5">{review.text}</Text>
      )}

      {images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2.5 -mx-1"
          contentContainerStyle={{ paddingHorizontal: 4 }}
        >
          {images.map((img, i) => (
            <Image
              key={i}
              source={img}
              style={{ width: 92, height: 92, borderRadius: 12, marginRight: 8 }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ---------- AI summary panel ----------
function AiSummaryPanel({
  summary,
  loading,
  error,
  onRetry,
  onContinueInChat,
}: {
  summary: AiSummary | null;
  loading: boolean;
  error?: AiError | null;
  onRetry?: () => void;
  onContinueInChat?: () => void;
}) {
  if (loading) {
    return (
      <View className="px-5 py-12 items-center">
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text className="text-gray-500 text-sm text-center mt-3">
          กำลังดึงสรุปจากเซิร์ฟเวอร์...
        </Text>
      </View>
    );
  }

  // A failed fetch used to render as "the system is still processing…", which
  // sent people off to wait for a summary that was never coming. Show the
  // actual reason and offer a retry.
  if (error) {
    return (
      <View className="px-5 py-10 items-center">
        <ExclamationTriangleIcon size={30} color="#DC2626" />
        <Text className="text-red-700 text-sm font-bold text-center mt-3">
          ดึงสรุปจาก AI ไม่สำเร็จ
        </Text>
        <Text className="text-gray-600 text-[13px] text-center mt-2 leading-5">
          {error.message}
        </Text>
        <Text className="text-gray-400 text-[11px] text-center mt-1.5">
          {error.status !== null ? `HTTP ${error.status} · ` : ""}
          {error.requestId ? `req ${error.requestId} · ` : ""}
          {Math.round(error.durationMs)}ms
        </Text>
        {onRetry ? (
          <TouchableOpacity
            onPress={onRetry}
            activeOpacity={0.8}
            className="mt-4 bg-red-600 rounded-xl px-5 py-2.5 flex-row items-center"
          >
            <ArrowPathIcon size={16} color="#FFFFFF" />
            <Text className="text-white text-[13px] font-bold ml-1.5">ลองใหม่</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (!summary || summary.status === "processing") {
    return (
      <View className="px-5 py-10 items-center">
        <SparklesIcon size={30} color="#F59E0B" />
        <Text className="text-gray-500 text-sm text-center mt-3 leading-6">
          {summary?.text ??
            "ยังไม่มีสรุปจาก AI สำหรับวิดีโอนี้ — ระบบจะประมวลผลตอนอัปโหลดและแสดงที่นี่"}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 18, paddingBottom: 32 }}
    >
      {/* Header badge */}
      <View className="flex-row items-center mb-3">
        <View className="w-9 h-9 rounded-full bg-amber-100 items-center justify-center mr-2.5">
          <SparklesIcon size={18} color="#D97706" />
        </View>
        <View>
          <Text className="text-gray-900 font-black text-[15px]">สรุปจากเอไอ</Text>
          <Text className="text-gray-400 text-[10px]">
            วิเคราะห์เสียง + ภาพโดยอัตโนมัติ{summary.model ? ` • ${summary.model}` : ""}
          </Text>
        </View>
      </View>

      {/* Main summary — 2-paragraph friendly narrative */}
      <View className="bg-amber-50/90 border border-amber-200/80 rounded-2xl p-4 shadow-sm">
        <Text className="text-gray-800 text-[14px] leading-6 font-normal">
          {summary.text}
        </Text>
      </View>

      {/* Google Maps button — opens map if GPS link exists */}
      {summary.place?.location?.gps && (
        <TouchableOpacity
          onPress={() => Linking.openURL(summary.place!.location.gps!)}
          activeOpacity={0.8}
          className="mt-3 bg-blue-50 border border-blue-200 rounded-2xl py-3 px-4 flex-row items-center justify-center shadow-sm"
        >
          <Text className="text-[14px]">🗺️</Text>
          <Text className="text-blue-700 font-bold text-[13.5px] ml-2">ดูพิกัดบน Google Maps</Text>
        </TouchableOpacity>
      )}

      {/* Continue the conversation about this clip in the AI chat */}
      {onContinueInChat && (
        <TouchableOpacity
          onPress={onContinueInChat}
          activeOpacity={0.85}
          className="mt-3 bg-violet-600 rounded-2xl py-3.5 flex-row items-center justify-center shadow-sm"
        >
          <ChatBubbleLeftRightIcon size={17} color="#FFFFFF" />
          <Text className="text-white font-bold text-[14px] ml-2">คุยต่อกับ AI เรื่องนี้</Text>
        </TouchableOpacity>
      )}

      <Text className="text-gray-400 text-[10.5px] text-center mt-5">
        สรุปนี้สร้างโดย AI อาจมีความคลาดเคลื่อนได้
      </Text>
    </ScrollView>
  );
}

export default function CommentSheet({ visible, postId, onClose }: CommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const base = useMemo(() => getPostCommentData(postId), [postId]);
  const { openChatWithSeed } = useAiPlanner();

  // Fixed sheet height so it never grows/shrinks with its content (the AI tab
  // used to push the sheet past the top; the empty state used to shrink it).
  // Web/desktop keeps a taller sheet; phones & tablets use 40% of the screen.
  const heightRatio = Platform.OS === "web" ? 0.5 : 0.4;
  const sheetHeight = Math.min(Math.round(screenH * heightRatio), 500);

  // --- Swipe-down-to-dismiss (uses core Animated + PanResponder, no new deps) ---
  // The <Modal animationType="slide"> owns the close animation, so closeSheet
  // just calls onClose() ONCE (guarded) — no second manual animation, which
  // was causing the sheet to appear to close twice.
  const translateY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const resetPosition = () =>
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
  const closeSheet = () => {
    if (closingRef.current) return; // guard against double-close
    closingRef.current = true;
    translateY.setValue(0); // reset drag offset; Modal handles the slide-out
    onClose();
  };
  const panResponder = useRef(
    PanResponder.create({
      // Only take over for a deliberate vertical drag (so taps/horizontal scroll pass through).
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        // Drag far enough OR flick down → close; otherwise snap back.
        if (g.dy > 110 || g.vy > 0.9) closeSheet();
        else resetPosition();
      },
      onPanResponderTerminate: () => resetPosition(),
    })
  ).current;

  const [tab, setTab] = useState<TabKey>("comments");

  // Local, editable copies so new comments/replies appear immediately
  const [comments, setComments] = useState<CommentItem[]>(base.comments);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string } | null>(null);

  // AI summary is fetched from the backend (not read from local data)
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<AiError | null>(null);
  const [aiFetchedFor, setAiFetchedFor] = useState<string | null>(null);

  // Build a seed message from the AI summary + hand it to the AI chat.
  const handleContinueInChat = () => {
    if (!aiSummary || aiSummary.status !== "ready") return;
    const place = aiSummary.place?.place_name;
    const seed =
      `ช่วยเล่าเพิ่มเติม / แนะนำเกี่ยวกับคลิปนี้หน่อย\n\n` +
      (place ? `สถานที่: ${place}\n` : "") +
      `สรุปจาก AI: ${aiSummary.text}`;
    openChatWithSeed(seed);
    onClose();
  };

  // Reset local state whenever a different post opens
  useEffect(() => {
    setComments(base.comments);
    setTab("comments");
    setDraft("");
    setReplyTarget(null);
    setAiSummary(null);
    setAiFetchedFor(null);
  }, [base, postId]);

  // Re-arm the close guard + drag position each time the sheet opens.
  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  // Lazily fetch the AI summary the first time the AI tab is opened for a post.
  // Failures are NOT latched — the user can hit "ลองใหม่" instead of being
  // stuck on the fake "processing…" message for the rest of the session.
  useEffect(() => {
    if (!visible || tab !== "ai") return;
    if (aiFetchedFor === postId) return; // already fetched for this post

    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    fetchAiSummary(postId)
      .then((result) => {
        if (cancelled) return;
        setAiSummary(result.summary);
        setAiError(result.kind === "error" ? result.error : null);
        // Only latch on a real answer, so an error stays retryable.
        if (result.kind !== "error") setAiFetchedFor(postId);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[commentSheet] ai summary fetch FAIL", err?.message ?? err);
        setAiSummary(null);
        setAiError(asAiError(err));
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, tab, postId, aiFetchedFor]);

  const commentCount = countComments({ ...base, comments });
  const reviewCount = countReviews(base);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;

    if (replyTarget) {
      const reply = makeLocalReply(text);
      setComments((prev) =>
        prev.map((c) =>
          c.id === replyTarget.id ? { ...c, replies: [...c.replies, reply] } : c
        )
      );
    } else {
      setComments((prev) => [makeLocalComment(text), ...prev]);
    }
    setDraft("");
    setReplyTarget(null);
  };

  const startReply = (commentId: string, name: string) => {
    setReplyTarget({ id: commentId, name });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSheet}>
      {/* Dim backdrop — tap to close */}
      <TouchableWithoutFeedback onPress={closeSheet}>
        <View className="flex-1" />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Animated.View
          className="rounded-t-3xl overflow-hidden"
          style={{
            height: sheetHeight,
            paddingBottom: Math.max(insets.bottom, 10),
            transform: [{ translateY }],
            // Inline bg so it never drops out on web (nativewind + Animated.View
            // sometimes misses the className background there).
            backgroundColor: "#FFFFFF",
          }}
        >
          {/* Drag zone: grab handle + header (swipe down here to close) */}
          <View {...panResponder.panHandlers}>
            {/* Grab handle */}
            <View className="items-center pt-2.5 pb-1">
              <View className="w-10 h-1.5 rounded-full bg-gray-300" />
            </View>

            {/* Header row: tabs + AI button + close */}
            <View className="flex-row items-center justify-between px-4 pt-1 pb-3 border-b border-gray-100">
            <View className="flex-row items-center flex-1">
              <TouchableOpacity onPress={() => setTab("comments")} activeOpacity={0.7} className="mr-4">
                <Text
                  className={`text-[15px] ${
                    tab === "comments" ? "font-black text-gray-900" : "font-semibold text-gray-400"
                  }`}
                >
                  ความคิดเห็น {commentCount}
                </Text>
                {tab === "comments" && <View className="h-0.5 bg-gray-900 rounded-full mt-1" />}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setTab("reviews")} activeOpacity={0.7}>
                <Text
                  className={`text-[15px] ${
                    tab === "reviews" ? "font-black text-gray-900" : "font-semibold text-gray-400"
                  }`}
                >
                  รีวิว {reviewCount}
                </Text>
                {tab === "reviews" && <View className="h-0.5 bg-gray-900 rounded-full mt-1" />}
              </TouchableOpacity>
            </View>

            {/* AI Summary pill */}
            <TouchableOpacity
              onPress={() => setTab("ai")}
              activeOpacity={0.85}
              className={`flex-row items-center px-3.5 py-2 rounded-full mr-2 ${
                tab === "ai" ? "bg-[#C2410C]" : "bg-[#F59E0B]"
              }`}
            >
              <Text className="text-white font-bold text-[12px] mr-1">สรุปจากเอไอ</Text>
              <MapPinIcon size={13} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity onPress={closeSheet} activeOpacity={0.7} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          <View
            className="flex-1"
            style={
              // On web a flex child must have minHeight:0 (and clip overflow)
              // for an inner FlatList/ScrollView to actually scroll. Native
              // handles this on its own, so only apply it on web.
              Platform.OS === "web" ? { minHeight: 0, overflow: "hidden" } : undefined
            }
          >
            {tab === "comments" && (
              // ScrollView (not FlatList) so it scrolls reliably on web, like
              // the AI tab. Comment counts per post are small, so no need to
              // virtualize.
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
              >
                {comments.length === 0 ? (
                  <View className="py-16 items-center">
                    <Text className="text-gray-400 text-sm">ยังไม่มีความคิดเห็น มาเป็นคนแรกกันเลย</Text>
                  </View>
                ) : (
                  comments.map((item, i) => (
                    <View key={item.id}>
                      <CommentRow comment={item} onReply={startReply} />
                      {i < comments.length - 1 && <View className="h-px bg-gray-100 ml-16" />}
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            {tab === "reviews" && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {base.reviews.length === 0 ? (
                  <View className="py-16 items-center">
                    <Text className="text-gray-400 text-sm">ยังไม่มีรีวิว</Text>
                  </View>
                ) : (
                  base.reviews.map((item) => <ReviewRow key={item.id} review={item} />)
                )}
              </ScrollView>
            )}

            {tab === "ai" && (
              <AiSummaryPanel
                summary={aiSummary}
                loading={aiLoading}
                error={aiError}
                onRetry={
                  aiError
                    ? () => {
                        // Clear the latch + error so the effect re-runs.
                        setAiError(null);
                        setAiFetchedFor(null);
                      }
                    : undefined
                }
                onContinueInChat={
                  aiSummary?.status === "ready" ? handleContinueInChat : undefined
                }
              />
            )}
          </View>

          {/* Composer (hidden on AI tab) */}
          {tab !== "ai" && (
            <View className="border-t border-gray-100 px-3 pt-2.5">
              {replyTarget && (
                <View className="flex-row items-center justify-between px-1 pb-1.5">
                  <Text className="text-gray-500 text-[11px]">
                    กำลังตอบกลับ <Text className="font-bold text-gray-700">{replyTarget.name}</Text>
                  </Text>
                  <TouchableOpacity onPress={() => setReplyTarget(null)} activeOpacity={0.6}>
                    <Text className="text-gray-400 text-[11px] font-semibold">ยกเลิก</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View className="flex-row items-center">
                {tab === "reviews" && (
                  <TouchableOpacity activeOpacity={0.7} className="mr-2 w-9 h-9 rounded-full bg-gray-100 items-center justify-center">
                    <PhotoIcon size={18} color="#6B7280" />
                  </TouchableOpacity>
                )}
                <View className="flex-1 flex-row items-center bg-gray-100 rounded-full px-4 py-2">
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={
                      tab === "reviews"
                        ? "เขียนรีวิวของคุณ..."
                        : replyTarget
                        ? `ตอบกลับ ${replyTarget.name}...`
                        : "แสดงความคิดเห็น..."
                    }
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 text-[13px] text-gray-900 py-0"
                    multiline
                  />
                </View>
                <TouchableOpacity
                  onPress={handleSend}
                  activeOpacity={0.8}
                  disabled={!draft.trim()}
                  className={`ml-2 w-10 h-10 rounded-full items-center justify-center ${
                    draft.trim() ? "bg-[#2D6A4F]" : "bg-gray-200"
                  }`}
                >
                  <PaperAirplaneIcon size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
