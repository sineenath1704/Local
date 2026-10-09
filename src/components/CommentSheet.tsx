import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  XMarkIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  MapPinIcon,
  StarIcon as StarOutline,
  HeartIcon as HeartOutline,
  PhotoIcon,
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
}: {
  summary: AiSummary | null;
  loading: boolean;
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

      {/* Main summary */}
      <View className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
        <Text className="text-gray-800 text-[13.5px] leading-6">{summary.text}</Text>
      </View>

      {/* Structured place info (Video Content Analyzer) */}
      {summary.place && (
        <View className="mt-4 bg-white border border-gray-200 rounded-2xl p-4">
          {summary.place.place_name && (
            <Text className="text-gray-900 font-black text-[15px] mb-0.5">
              📍 {summary.place.place_name}
            </Text>
          )}
          {(summary.place.location.district || summary.place.location.province) && (
            <Text className="text-gray-500 text-[12px] mb-2">
              {[summary.place.location.subdistrict, summary.place.location.district, summary.place.location.province]
                .filter(Boolean)
                .join(" • ")}
            </Text>
          )}

          {!!summary.place.category?.length && (
            <View className="flex-row flex-wrap mb-1">
              {summary.place.category.map((c, i) => (
                <View key={i} className="bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 mr-1.5 mb-1.5">
                  <Text className="text-[#2D6A4F] text-[11px] font-semibold">{c}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Price */}
          {(summary.place.price_info?.weekday || summary.place.price_info?.weekend) && (
            <View className="flex-row items-start mt-1.5">
              <Text className="text-gray-500 text-[12px] w-16">ราคา</Text>
              <Text className="text-gray-800 text-[12.5px] flex-1 font-medium">
                {[
                  summary.place.price_info.weekday && `วันธรรมดา ${summary.place.price_info.weekday}`,
                  summary.place.price_info.weekend && `วันหยุด ${summary.place.price_info.weekend}`,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </Text>
            </View>
          )}

          {/* Opening hours */}
          {summary.place.opening_hours && (
            <View className="flex-row items-start mt-1.5">
              <Text className="text-gray-500 text-[12px] w-16">เวลา</Text>
              <Text className="text-gray-800 text-[12.5px] flex-1">{summary.place.opening_hours}</Text>
            </View>
          )}

          {/* Contact */}
          {(summary.place.contact?.phone || summary.place.contact?.facebook || summary.place.contact?.line) && (
            <View className="flex-row items-start mt-1.5">
              <Text className="text-gray-500 text-[12px] w-16">ติดต่อ</Text>
              <Text className="text-gray-800 text-[12.5px] flex-1">
                {[summary.place.contact.phone, summary.place.contact.facebook, summary.place.contact.line]
                  .filter(Boolean)
                  .join(" • ")}
              </Text>
            </View>
          )}

          {/* Activities */}
          {!!summary.place.activities?.length && (
            <View className="flex-row items-start mt-1.5">
              <Text className="text-gray-500 text-[12px] w-16">กิจกรรม</Text>
              <Text className="text-gray-800 text-[12.5px] flex-1">
                {summary.place.activities.join(", ")}
              </Text>
            </View>
          )}

          {/* OTOP products */}
          {!!summary.place.otop_products?.length && (
            <View className="flex-row items-start mt-1.5">
              <Text className="text-gray-500 text-[12px] w-16">OTOP</Text>
              <Text className="text-gray-800 text-[12.5px] flex-1">
                {summary.place.otop_products.join(", ")}
              </Text>
            </View>
          )}

          {/* Confidence warning */}
          {summary.place.confidence?.warning && (
            <Text className="text-amber-600 text-[11px] mt-2.5">
              ⚠️ {summary.place.confidence.warning}
            </Text>
          )}
        </View>
      )}

      {/* Highlights */}
      {!!summary.highlights?.length && (
        <View className="mt-4">
          <Text className="text-gray-900 font-bold text-[13px] mb-2">✨ จุดเด่น</Text>
          {summary.highlights.map((h, i) => (
            <View key={i} className="flex-row mb-1.5">
              <Text className="text-amber-600 mr-2">•</Text>
              <Text className="text-gray-700 text-[12.5px] leading-5 flex-1">{h}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Tags */}
      {!!summary.tags?.length && (
        <View className="mt-3 flex-row flex-wrap">
          {summary.tags.map((t, i) => (
            <View key={i} className="bg-violet-50 rounded-full px-2.5 py-1 mr-1.5 mb-1.5">
              <Text className="text-violet-700 text-[11px] font-semibold">{t}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Transcript highlights (เสียง → Text) */}
      {!!summary.transcriptHighlights?.length && (
        <View className="mt-4">
          <Text className="text-gray-900 font-bold text-[13px] mb-2">
            🎙️ ประเด็นจากเสียงพูด
          </Text>
          {summary.transcriptHighlights.map((h, i) => (
            <View key={i} className="flex-row mb-1.5">
              <Text className="text-amber-600 mr-2">•</Text>
              <Text className="text-gray-700 text-[12.5px] leading-5 flex-1">{h}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Visual tags (ภาพ → Visual info) */}
      {!!summary.visualTags?.length && (
        <View className="mt-4">
          <Text className="text-gray-900 font-bold text-[13px] mb-2">👀 สิ่งที่เห็นในวิดีโอ</Text>
          <View className="flex-row flex-wrap">
            {summary.visualTags.map((t, i) => (
              <View key={i} className="bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 mr-2 mb-2">
                <Text className="text-[#2D6A4F] text-[11px] font-semibold">{t}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* On-screen text */}
      {!!summary.onScreenText?.length && (
        <View className="mt-2">
          <Text className="text-gray-900 font-bold text-[13px] mb-2">🔤 ข้อความบนหน้าจอ</Text>
          <View className="flex-row flex-wrap">
            {summary.onScreenText.map((t, i) => (
              <View key={i} className="bg-gray-100 rounded-lg px-2.5 py-1 mr-2 mb-2">
                <Text className="text-gray-600 text-[11px]">“{t}”</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text className="text-gray-300 text-[10px] text-center mt-5">
        สรุปนี้สร้างโดย AI อาจมีความคลาดเคลื่อนได้
      </Text>
    </ScrollView>
  );
}

export default function CommentSheet({ visible, postId, onClose }: CommentSheetProps) {
  const insets = useSafeAreaInsets();
  const base = useMemo(() => getPostCommentData(postId), [postId]);

  const [tab, setTab] = useState<TabKey>("comments");

  // Local, editable copies so new comments/replies appear immediately
  const [comments, setComments] = useState<CommentItem[]>(base.comments);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string } | null>(null);

  // AI summary is fetched from the backend (not read from local data)
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFetchedFor, setAiFetchedFor] = useState<string | null>(null);

  // Reset local state whenever a different post opens
  useEffect(() => {
    setComments(base.comments);
    setTab("comments");
    setDraft("");
    setReplyTarget(null);
    setAiSummary(null);
    setAiFetchedFor(null);
  }, [base, postId]);

  // Lazily fetch the AI summary the first time the AI tab is opened for a post
  useEffect(() => {
    if (!visible || tab !== "ai") return;
    if (aiFetchedFor === postId) return; // already fetched for this post

    let cancelled = false;
    setAiLoading(true);
    fetchAiSummary(postId)
      .then((summary) => {
        if (!cancelled) {
          setAiSummary(summary);
          setAiFetchedFor(postId);
        }
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Dim backdrop — tap to close */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <View
          className="bg-white rounded-t-3xl overflow-hidden"
          style={{ height: "75%", paddingBottom: Math.max(insets.bottom, 10) }}
        >
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

            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View className="flex-1">
            {tab === "comments" && (
              <FlatList
                data={comments}
                keyExtractor={(c) => c.id}
                renderItem={({ item }) => <CommentRow comment={item} onReply={startReply} />}
                ItemSeparatorComponent={() => <View className="h-px bg-gray-100 ml-16" />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
                ListEmptyComponent={
                  <View className="py-16 items-center">
                    <Text className="text-gray-400 text-sm">ยังไม่มีความคิดเห็น มาเป็นคนแรกกันเลย</Text>
                  </View>
                }
              />
            )}

            {tab === "reviews" && (
              <FlatList
                data={base.reviews}
                keyExtractor={(r) => r.id}
                renderItem={({ item }) => <ReviewRow review={item} />}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View className="py-16 items-center">
                    <Text className="text-gray-400 text-sm">ยังไม่มีรีวิว</Text>
                  </View>
                }
              />
            )}

            {tab === "ai" && <AiSummaryPanel summary={aiSummary} loading={aiLoading} />}
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
