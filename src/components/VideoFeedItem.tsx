import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Easing,
  StyleSheet,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";

// Heroicons - Solid
import {
  HeartIcon as HeartSolid,
  BookmarkIcon as BookmarkSolid,
  MapPinIcon as MapPinSolid,
  PlayIcon as PlaySolid,
  CheckIcon,
  GlobeAltIcon as GlobeAltSolid,
  BuildingStorefrontIcon as StoreSolid,
} from "react-native-heroicons/solid";

// Heroicons - Outline
import {
  HeartIcon as HeartOutline,
  BookmarkIcon as BookmarkOutline,
  ChatBubbleOvalLeftEllipsisIcon as CommentOutline,
  ShareIcon as ShareOutline,
  HomeModernIcon,
  ArrowRightIcon,
  PlusIcon,
  MapIcon as MapOutline,
} from "react-native-heroicons/outline";

import { MapSelectionInfo } from "../Pages/Map/MapScreen";
import { VideoPost } from "../data/homeFeedData";
import CommentSheet from "./CommentSheet";
import { useInteractions } from "../state/InteractionContext";
import { getPostCommentData, countComments } from "../data/commentsData";

// Fallback avatar when a Supabase row has no avatar_url yet.
const DEFAULT_AVATAR = require("../../assets/persona_pa_somsri.jpg");

export interface VideoFeedItemProps {
  post: VideoPost;
  isActive: boolean;
  screenHeight: number;
  isSmallDevice: boolean;
  bottomOffset: number;
  topInset: number;
  onOpenMap?: (provinceName?: string) => void;
  mapSelection?: MapSelectionInfo | null;
  onOpenProfile?: (authorId: string) => void;
  onRequestSave?: (videoId: string) => void;
  onRequestShare?: (videoId: string) => void;
}

export default function VideoFeedItem({
  post,
  isActive,
  screenHeight,
  isSmallDevice,
  bottomOffset,
  topInset,
  onOpenMap,
  mapSelection,
  onOpenProfile,
  onRequestSave,
  onRequestShare,
}: VideoFeedItemProps) {
  // Action-driven state from the global interaction store (real taps only)
  const { isLiked: isLikedFn, isSaved: isSavedFn, toggleLike, isFollowing: isFollowingFn, toggleFollow } =
    useInteractions();
  const isLiked = isLikedFn(post.id);
  const isSaved = isSavedFn(post.id);
  const isFollowing = isFollowingFn(post.authorId);

  // Like count = real taps only (no mock base): 0 or 1 for the current user
  const likesCount = isLiked ? 1 : 0;
  // Comment count = number of REAL comments/replies that exist for this post
  const commentCount = countComments(getPostCommentData(post.id));

  const [showComments, setShowComments] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showPlayIcon, setShowPlayIcon] = useState<boolean>(false);
  const playIconOpacity = useRef(new Animated.Value(0)).current;

  // Video Player hook for this post
  const player = useVideoPlayer(post.videoSource, (p) => {
    p.loop = true;
    p.muted = false;
    if (isActive) {
      p.play();
    } else {
      p.pause();
    }
  });

  // Control playback based on active visibility
  useEffect(() => {
    if (!player) return;
    if (isActive) {
      player.play();
      setIsPlaying(true);
    } else {
      player.pause();
      setIsPlaying(false);
    }
  }, [isActive, player]);

  // Spinning Vinyl Animation
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let spinAnimation: Animated.CompositeAnimation | null = null;
    if (isActive && isPlaying) {
      spinAnimation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 5000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      spinAnimation.start();
    } else {
      spinValue.stopAnimation();
    }

    return () => {
      spinAnimation?.stop();
    };
  }, [isActive, isPlaying, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Tap to play/pause
  const handleTogglePlay = () => {
    if (!player) return;

    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }

    setShowPlayIcon(true);
    playIconOpacity.setValue(1);
    Animated.timing(playIconOpacity, {
      toValue: 0,
      duration: 650,
      delay: 300,
      useNativeDriver: true,
    }).start(() => setShowPlayIcon(false));
  };

  // Like → global store (video appears in profile "liked" tab)
  const handleToggleLike = () => toggleLike(post.id);

  // Save → open the folder picker sheet (handled by parent screen)
  const handleSavePress = () => onRequestSave?.(post.id);

  // Share → open the share sheet (friends / copy link), handled by parent
  const handleSharePress = () => onRequestShare?.(post.id);

  const formatCount = (count: number) => {
    if (count >= 1000) return (count / 1000).toFixed(1) + "k";
    return count.toString();
  };

  return (
    <View
      style={{
        width: "100%",
        height: screenHeight,
      }}
      className="relative bg-black"
    >
      {/* Video View — centered, shows the whole frame (no side cropping) */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <VideoView
          player={player}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          nativeControls={false}
        />
      </View>

      {/* Tap area to pause / resume video */}
      <TouchableWithoutFeedback onPress={handleTogglePlay}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      {/* Play / Pause Indicator */}
      {showPlayIcon && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: playIconOpacity,
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
          pointerEvents="none"
        >
          <View className="w-16 h-16 rounded-full bg-black/50 items-center justify-center">
            <PlaySolid size={36} color="#FFFFFF" />
          </View>
        </Animated.View>
      )}

      {/* Top Gradient */}
      <LinearGradient
        colors={["rgba(0,0,0,0.7)", "rgba(0,0,0,0.25)", "transparent"]}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: Math.max(topInset + 70, 130),
        }}
        pointerEvents="none"
      />

      {/* Bottom Gradient */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.88)"]}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: isSmallDevice ? 320 : 400,
        }}
        pointerEvents="none"
      />

      {/* Top Header Bar */}
      <View
        style={{
          paddingTop: Math.max(topInset, 16) + (Platform.OS === "android" ? 10 : 6),
          paddingHorizontal: isSmallDevice ? 16 : 20,
        }}
        className="w-full flex-row items-center justify-between z-20"
        pointerEvents="box-none"
      >
        {/* Logo Local */}
        <View className="flex-row items-baseline">
          <Text className="text-white text-2xl font-black tracking-tight">
            Local
          </Text>
          <View className="w-1.5 h-1.5 rounded-full bg-[#00D26A] ml-1 mb-1" />
        </View>

        {/* Center Tab: "สำหรับคุณ" */}
        <View className="items-center">
          <Text className="text-white text-base font-bold tracking-wide">
            สำหรับคุณ
          </Text>
          <View className="h-0.5 w-10 bg-[#00D26A] rounded-full mt-1.5" />
        </View>

        {/* Top Right: Dynamic Map Pin / Map Level Button */}
        {(() => {
          // Determine icon and label based on map selection level
          let icon: React.ReactElement;
          let label: string;
          let iconBg: string;

          if (!mapSelection) {
            // Default: no selection — show map outline icon + post province
            icon = <MapOutline size={22} color="#FFFFFF" />;
            label = post.location.province;
            iconBg = "bg-black/40";
          } else if (mapSelection.level === "region") {
            // Region selected — Globe icon
            icon = <GlobeAltSolid size={22} color="#60A5FA" />;
            label = mapSelection.label;
            iconBg = "bg-blue-900/60";
          } else if (mapSelection.level === "province") {
            // Province selected — Map Pin solid (red)
            icon = <MapPinSolid size={22} color="#EF4444" />;
            label = mapSelection.label;
            iconBg = "bg-black/50";
          } else if (mapSelection.level === "district") {
            // District selected — Map Pin solid (green)
            icon = <MapPinSolid size={22} color="#00D26A" />;
            label = mapSelection.label;
            iconBg = "bg-emerald-900/60";
          } else {
            // Place selected — Store / community icon (amber)
            icon = <StoreSolid size={20} color="#FBBF24" />;
            label =
              mapSelection.label.length > 12
                ? mapSelection.label.slice(0, 12) + "…"
                : mapSelection.label;
            iconBg = "bg-amber-900/60";
          }

          return (
            <TouchableOpacity
              onPress={() => onOpenMap?.(post.location.province)}
              activeOpacity={0.8}
              className="items-center"
            >
              <View
                className={`w-11 h-11 rounded-full ${iconBg} border border-white/20 items-center justify-center`}
              >
                {icon}
              </View>
              <Text
                className="text-white/90 text-[10px] font-semibold mt-1 text-center"
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })()}
      </View>

      {/* Right Action Bar (Avatar, Like, Comment, Save, Share, Vinyl) */}
      <View
        style={{
          position: "absolute",
          right: isSmallDevice ? 10 : 14,
          bottom: bottomOffset,
        }}
        className="items-center z-20"
      >
        {/* Author Avatar (tap → open that profile) & Follow Button */}
        <View className="items-center mb-4">
          <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenProfile?.(post.authorId)}>
            <Image
              source={post.author.avatar ?? DEFAULT_AVATAR}
              style={{ width: 48, height: 48, borderRadius: 24 }}
              className="border-2 border-white"
            />
          </TouchableOpacity>
          {/* Follow Button (hidden when already following) */}
          <TouchableOpacity
            onPress={() => toggleFollow(post.authorId)}
            activeOpacity={0.8}
            className={`w-5 h-5 rounded-full items-center justify-center -mt-2.5 border border-white ${
              isFollowing ? "bg-[#00D26A]" : "bg-[#EA580C]"
            }`}
          >
            {isFollowing ? (
              <CheckIcon size={12} color="#FFFFFF" strokeWidth={3} />
            ) : (
              <PlusIcon size={13} color="#FFFFFF" strokeWidth={3} />
            )}
          </TouchableOpacity>
        </View>

        {/* Like Button (Individual State) */}
        <TouchableOpacity
          onPress={handleToggleLike}
          activeOpacity={0.7}
          className="items-center mb-3.5"
        >
          <View className="w-10 h-10 items-center justify-center">
            {isLiked ? (
              <HeartSolid size={32} color="#EF4444" />
            ) : (
              <HeartOutline size={32} color="#FFFFFF" strokeWidth={1.8} />
            )}
          </View>
          <Text className="text-white text-[11px] font-semibold mt-0.5">
            {formatCount(likesCount)}
          </Text>
        </TouchableOpacity>

        {/* Comment Button — opens the comment / review / AI-summary sheet */}
        <TouchableOpacity
          onPress={() => setShowComments(true)}
          activeOpacity={0.7}
          className="items-center mb-3.5"
        >
          <View className="w-10 h-10 items-center justify-center">
            <CommentOutline size={30} color="#FFFFFF" strokeWidth={1.8} />
          </View>
          <Text className="text-white text-[11px] font-semibold mt-0.5">
            {formatCount(commentCount)}
          </Text>
        </TouchableOpacity>

        {/* Save / Bookmark Button — opens folder picker */}
        <TouchableOpacity
          onPress={handleSavePress}
          activeOpacity={0.7}
          className="items-center mb-3.5"
        >
          <View className="w-10 h-10 items-center justify-center">
            {isSaved ? (
              <BookmarkSolid size={30} color="#00D26A" />
            ) : (
              <BookmarkOutline size={30} color="#FFFFFF" strokeWidth={1.8} />
            )}
          </View>
          <Text className="text-white text-[11px] font-semibold mt-0.5">
            {isSaved ? "บันทึกแล้ว" : "บันทึก"}
          </Text>
        </TouchableOpacity>

        {/* Share Button — opens share sheet */}
        <TouchableOpacity
          onPress={handleSharePress}
          activeOpacity={0.7}
          className="items-center mb-4"
        >
          <View className="w-10 h-10 items-center justify-center">
            <ShareOutline size={28} color="#FFFFFF" strokeWidth={1.8} />
          </View>
          <Text className="text-white text-[11px] font-semibold mt-0.5">แชร์</Text>
        </TouchableOpacity>

        {/* Vinyl Music Record (Spinning) */}
        <Animated.View
          style={{
            transform: [{ rotate: spin }],
          }}
          className="w-11 h-11 rounded-full items-center justify-center bg-[#1E1E1E] border-2 border-[#D4AF37] shadow-lg shadow-black"
        >
          <View className="w-8 h-8 rounded-full border border-[#D4AF37]/50 items-center justify-center bg-[#2B220C]">
            <View className="w-4 h-4 rounded-full bg-[#E5B84B] border border-black" />
          </View>
        </Animated.View>
      </View>

      {/* Bottom Metadata & Booking CTA */}
      <View
        style={{
          position: "absolute",
          left: isSmallDevice ? 12 : 16,
          right: 76, // เว้นช่องขวาไม่ให้ชนกับแถบ Like/Comment/Share
          bottom: bottomOffset - 4,
        }}
        className="z-20"
      >
        {/* Community Name (tap → open profile) */}
        <TouchableOpacity activeOpacity={0.7} onPress={() => onOpenProfile?.(post.authorId)}>
          <Text
            className={`text-white font-bold tracking-tight mb-1 ${
              isSmallDevice ? "text-sm" : "text-base"
            }`}
          >
            {post.author.handle}
          </Text>
        </TouchableOpacity>

        {/* Location Pin */}
        <View className="flex-row items-center mb-1">
          <Text className="text-xs mr-1">📍</Text>
          <Text
            numberOfLines={1}
            className="text-white/90 text-[11px] font-medium flex-shrink"
          >
            {post.location.village} {post.location.district} จ.{post.location.province}
          </Text>
        </View>

        {/* Caption */}
        <Text
          numberOfLines={isSmallDevice ? 2 : 3}
          className="text-white/95 text-xs leading-5 mb-1.5"
        >
          {post.caption}
        </Text>

        {/* Hashtags */}
        <Text
          numberOfLines={1}
          className="text-white/80 text-[11px] font-medium mb-2.5"
        >
          {post.hashtags.join(" ")}
        </Text>

        {/* Homestay Booking CTA Pill */}
        <TouchableOpacity
          activeOpacity={0.85}
          className="bg-[#1C523A] border border-[#00D26A]/40 rounded-full py-2 px-3.5 flex-row items-center justify-between shadow-lg shadow-black self-start max-w-full"
        >
          <View className="flex-row items-center flex-shrink mr-2">
            <View className="w-6 h-6 rounded-full bg-[#00D26A]/20 items-center justify-center mr-2">
              <HomeModernIcon size={14} color="#00D26A" />
            </View>
            <Text
              numberOfLines={1}
              className="text-white text-[12px] font-medium flex-shrink"
            >
              {post.booking.roomsText} • {post.booking.price}.- / คืน
            </Text>
          </View>

          <View className="flex-row items-center">
            <Text className="text-[#00D26A] text-[12px] font-bold mr-1">
              จองเลย
            </Text>
            <ArrowRightIcon size={12} color="#00D26A" strokeWidth={2.5} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Comment / Review / AI-summary bottom sheet */}
      <CommentSheet
        visible={showComments}
        postId={post.id}
        onClose={() => setShowComments(false)}
      />
    </View>
  );
}
