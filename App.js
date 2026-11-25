import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, StatusBar, Image, ScrollView, Modal, TextInput,
  PanResponder, Animated, BackHandler, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView, useWindowDimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Brightness from 'expo-brightness';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

/* ───────────────────────── Design tokens ───────────────────────── */

const C = {
  bg: '#100E1B',          // plum ink
  surface: '#1A1728',
  raised: '#262040',
  line: 'rgba(255,255,255,0.09)',
  text: '#F1EFFA',
  muted: '#9B96B8',
  accent: '#8F9BFF',      // periwinkle
  onAccent: '#10112B',
  amber: '#FFC56E',       // "your progress" colour
  danger: '#FF7A8A',
  glass: 'rgba(16,14,27,0.58)',
};
const F = { m: 'Manrope_500Medium', sb: 'Manrope_600SemiBold', b: 'Manrope_700Bold', xb: 'Manrope_800ExtraBold' };

const SAMPLE_URI = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FITS = [
  { key: 'contain', label: 'Fit to screen' },
  { key: 'cover', label: 'Fill screen' },
  { key: 'fill', label: 'Stretch' },
];
const SEEK = 10;

/* ───────────────────────── Helpers ───────────────────────── */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const fmt = (sec = 0) => {
  const t = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

const fmtLeft = (sec) => {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
};

const titleFromUri = (uri) => {
  try {
    const last = decodeURIComponent(uri.split('?')[0].split('/').filter(Boolean).pop() || 'Video');
    return last.replace(/\.[^.]+$/, '') || 'Video';
  } catch {
    return 'Video';
  }
};

const isFinished = (it) => it.dur > 0 && it.pos >= it.dur - 8;
const statusLine = (it) => {
  if (isFinished(it)) return 'Finished';
  if (it.pos > 5 && it.dur > 0) return fmtLeft(it.dur - it.pos);
  return it.dur > 0 ? fmt(it.dur) : 'Not started';
};

const LIB_KEY = 'library:v1';
const loadLibrary = async () => {
  try { const r = await AsyncStorage.getItem(LIB_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
};
const saveLibrary = async (list) => {
  try {
    const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
    await AsyncStorage.setItem(LIB_KEY, JSON.stringify(sorted));
  } catch {}
};

/* ───────────────────────── Root ───────────────────────── */

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const [library, setLibrary] = useState([]);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => { loadLibrary().then((l) => { setLibrary(l); setReady(true); }); }, []);
  useEffect(() => { if (ready) saveLibrary(library); }, [library, ready]);

  const upsert = useCallback((uri, patch) => {
    setLibrary((prev) => {
      const i = prev.findIndex((x) => x.uri === uri);
      if (i === -1) {
        return [{ uri, title: titleFromUri(uri), pos: 0, dur: 0, updatedAt: Date.now(), ...patch }, ...prev];
      }
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  const play = useCallback(async (uri, title) => {
    const existing = library.find((x) => x.uri === uri);
    const item = existing ? { ...existing } : { uri, title: title || titleFromUri(uri), pos: 0, dur: 0 };
    upsert(uri, { title: item.title, updatedAt: Date.now() });
    setCurrent(item);
    if (!existing?.thumb) {
      try {
        const t = await VideoThumbnails.getThumbnailAsync(uri, { time: 8000 });
        upsert(uri, { thumb: t.uri });
      } catch {}
    }
  }, [library, upsert]);

  const onProgress = useCallback((uri, pos, dur) => {
    upsert(uri, { pos, dur, updatedAt: Date.now() });
  }, [upsert]);

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: false });
      if (!res.canceled && res.assets?.[0]) {
        play(res.assets[0].uri, (res.assets[0].name || '').replace(/\.[^.]+$/, ''));
      }
    } catch {
      Alert.alert('Could not open that file', 'Try picking it again, or choose a different video.');
    }
  };

  const removeItem = (it) => {
    Alert.alert('Remove from library?', 'The video stays on your phone. Only your watch progress is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setLibrary((p) => p.filter((x) => x.uri !== it.uri)) },
    ]);
  };

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  if (current) {
    return (
      <Player
        key={current.uri}
        item={current}
        onClose={() => setCurrent(null)}
        onProgress={onProgress}
      />
    );
  }

  return (
    <>
      <Home
        library={library}
        onOpenFile={pickFile}
        onOpenLink={() => setLinkOpen(true)}
        onPlay={(it) => play(it.uri, it.title)}
        onSample={() => play(SAMPLE_URI, 'Big Buck Bunny (sample)')}
        onRemove={removeItem}
      />
      <LinkSheet
        visible={linkOpen}
        onClose={() => setLinkOpen(false)}
        onSubmit={(url) => { setLinkOpen(false); play(url); }}
      />
    </>
  );
}

/* ───────────────────────── Home ───────────────────────── */

function Thumb({ uri, style, radius = 12 }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return <Image source={{ uri }} style={[{ borderRadius: radius, backgroundColor: C.raised }, style]} onError={() => setFailed(true)} />;
  }
  return (
    <LinearGradient
      colors={[C.raised, C.surface]}
      style={[{ borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Ionicons name="film-outline" size={22} color={C.muted} />
    </LinearGradient>
  );
}

function Home({ library, onOpenFile, onOpenLink, onPlay, onSample, onRemove }) {
  const items = useMemo(() => [...library].sort((a, b) => b.updatedAt - a.updatedAt), [library]);
  const resumable = items.find((it) => it.pos > 5 && !isFinished(it));
  const rest = items.filter((it) => it !== resumable);

  return (
    <View style={h.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={h.scroll} showsVerticalScrollIndicator={false}>
        <Text style={h.title}>Library</Text>
        <Text style={h.sub}>Plays from your phone or any link. No account needed.</Text>

        <View style={h.actions}>
          <Pressable
            onPress={onOpenFile}
            android_ripple={{ color: 'rgba(16,17,43,0.2)' }}
            style={[h.btn, { backgroundColor: C.accent, flex: 1.25 }]}
          >
            <Ionicons name="folder-open-outline" size={20} color={C.onAccent} />
            <Text style={[h.btnText, { color: C.onAccent }]}>Open video</Text>
          </Pressable>
          <Pressable
            onPress={onOpenLink}
            android_ripple={{ color: 'rgba(255,255,255,0.1)' }}
            style={[h.btn, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, flex: 1 }]}
          >
            <Ionicons name="link-outline" size={20} color={C.text} />
            <Text style={[h.btnText, { color: C.text }]}>Paste link</Text>
          </Pressable>
        </View>

        {items.length === 0 && (
          <View style={h.empty}>
            <View style={h.emptyIcon}><Ionicons name="play" size={26} color={C.accent} /></View>
            <Text style={h.emptyTitle}>Nothing here yet</Text>
            <Text style={h.emptyBody}>Open a video from your phone or paste a stream link. Your place is saved automatically.</Text>
            <Pressable onPress={onSample} hitSlop={10}>
              <Text style={h.emptyLink}>Play a sample video</Text>
            </Pressable>
          </View>
        )}

        {resumable && (
          <>
            <Text style={h.section}>Continue watching</Text>
            <Pressable onPress={() => onPlay(resumable)} style={h.hero}>
              <Thumb uri={resumable.thumb} style={StyleSheet.absoluteFill} radius={20} />
              <LinearGradient colors={['transparent', 'rgba(16,14,27,0.92)']} style={h.heroShade} />
              <View style={h.heroPlay}><Ionicons name="play" size={22} color={C.onAccent} style={{ marginLeft: 2 }} /></View>
              <View style={h.heroBody}>
                <Text style={h.heroTitle} numberOfLines={1}>{resumable.title}</Text>
                <Text style={h.heroMeta}>{statusLine(resumable)}</Text>
                <View style={h.track}>
                  <View style={[h.trackFill, { width: `${clamp(resumable.pos / (resumable.dur || 1)) * 100}%` }]} />
                </View>
              </View>
            </Pressable>
          </>
        )}

        {rest.length > 0 && <Text style={h.section}>Recent</Text>}
        {rest.map((it) => (
          <Pressable
            key={it.uri}
            onPress={() => onPlay(it)}
            android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
            style={h.row}
          >
            <View>
              <Thumb uri={it.thumb} style={h.rowThumb} radius={10} />
              {it.pos > 5 && !isFinished(it) && (
                <View style={h.rowTrack}>
                  <View style={[h.trackFill, { width: `${clamp(it.pos / (it.dur || 1)) * 100}%` }]} />
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={h.rowTitle} numberOfLines={2}>{it.title}</Text>
              <Text style={h.rowMeta}>{statusLine(it)}</Text>
            </View>
            <Pressable onPress={() => onRemove(it)} hitSlop={12} style={h.rowMore}>
              <Ionicons name="close" size={18} color={C.muted} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function LinkSheet({ visible, onClose, onSubmit }) {
  const [url, setUrl] = useState('');
  const valid = /^https?:\/\/\S+/i.test(url.trim());
  useEffect(() => { if (!visible) setUrl(''); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={h.modalWrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={h.sheet}>
          <View style={h.grabber} />
          <Text style={h.sheetTitle}>Paste a video link</Text>
          <Text style={h.sheetSub}>Works with direct files such as .mp4 and streams such as .m3u8.</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/video.mp4"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={h.input}
          />
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <Pressable onPress={onClose} style={[h.btn, { flex: 1, backgroundColor: C.raised }]}>
              <Text style={[h.btnText, { color: C.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!valid}
              onPress={() => onSubmit(url.trim())}
              style={[h.btn, { flex: 1.4, backgroundColor: C.accent, opacity: valid ? 1 : 0.4 }]}
            >
              <Ionicons name="play" size={18} color={C.onAccent} />
              <Text style={[h.btnText, { color: C.onAccent }]}>Play</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ───────────────────────── Scrubber ───────────────────────── */

function Scrubber({ time, duration, onStart, onMove, onEnd }) {
  const [w, setW] = useState(1);
  const [drag, setDrag] = useState(null);
  const wRef = useRef(1);
  const startX = useRef(0);
  const cb = useRef({});
  cb.current = { onStart, onMove, onEnd, duration };

  const pan = useMemo(() => {
    const frac = (x) => clamp(x / wRef.current);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        const f = frac(startX.current);
        setDrag(f);
        cb.current.onStart();
        cb.current.onMove(f * cb.current.duration);
      },
      onPanResponderMove: (_, g) => {
        const f = frac(startX.current + g.dx);
        setDrag(f);
        cb.current.onMove(f * cb.current.duration);
      },
      onPanResponderRelease: (_, g) => {
        const f = frac(startX.current + g.dx);
        setDrag(null);
        cb.current.onEnd(f * cb.current.duration);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
        cb.current.onEnd(null);
      },
    });
  }, []);

  const f = drag ?? (duration > 0 ? clamp(time / duration) : 0);
  const active = drag !== null;
  const bubbleLeft = clamp(f * w - 30, 0, Math.max(0, w - 60));

  return (
    <View
      style={sc.hit}
      {...pan.panHandlers}
      onLayout={(e) => { wRef.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); }}
    >
      {active && (
        <View pointerEvents="none" style={[sc.bubble, { left: bubbleLeft }]}>
          <Text style={sc.bubbleText}>{fmt(f * duration)}</Text>
        </View>
      )}
      <View pointerEvents="none" style={[sc.track, active && { height: 7 }]}>
        <View style={[sc.fill, { width: `${f * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[sc.thumb, active && sc.thumbActive, { left: f * w - (active ? 11 : 7) }]}
      />
    </View>
  );
}

/* ───────────────────────── Player ───────────────────────── */

function RoundBtn({ icon, onPress, size = 22, label, active }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[p.round, active && { backgroundColor: C.accent }]}>
      <Ionicons name={icon} size={size} color={active ? C.onAccent : C.text} />
      {label ? <Text style={p.roundLabel}>{label}</Text> : null}
    </Pressable>
  );
}

function Player({ item, onClose, onProgress }) {
  const { width: W, height: H } = useWindowDimensions();
  const videoRef = useRef(null);

  const player = useVideoPlayer(item.uri, (pl) => {
    pl.timeUpdateEventInterval = 0.25;
    pl.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('loading');
  const [controlsOn, setControlsOn] = useState(true);
  const [locked, setLocked] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fitIdx, setFitIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hud, setHud] = useState(null);       // { kind, v }
  const [ripple, setRipple] = useState(null); // { side, text }
  const [toast, setToast] = useState(null);   // { text, action?, onAction? }

  const ctrl = useRef(new Animated.Value(1)).current;
  const rippleA = useRef(new Animated.Value(0)).current;

  const playingRef = useRef(true);
  const posRef = useRef(item.pos || 0);
  const durRef = useRef(item.dur || 0);
  const scrubbing = useRef(false);
  const lastSave = useRef(0);
  const resumed = useRef(false);
  const hideTimer = useRef(null);
  const toastTimer = useRef(null);
  const hudTimer = useRef(null);
  const layer = useRef({ width: 1, height: 1 });
  const bright = useRef(0.5);
  const vol = useRef(1);
  const rippleAcc = useRef({ t: 0, side: null, total: 0 });
  playingRef.current = isPlaying;

  /* controls visibility */
  const setControls = useCallback((on) => {
    setControlsOn(on);
    Animated.timing(ctrl, { toValue: on ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [ctrl]);

  const poke = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playingRef.current && !scrubbing.current) setControls(false);
    }, 3200);
  }, [setControls]);

  const showToast = useCallback((text, action, onAction) => {
    setToast({ text, action, onAction });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  /* lifecycle */
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    Brightness.getBrightnessAsync().then((v) => { bright.current = v; }).catch(() => {});
    poke();
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(toastTimer.current);
      clearTimeout(hudTimer.current);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      try { Brightness.restoreSystemBrightnessAsync?.(); } catch {}
      onProgress(item.uri, posRef.current, durRef.current);
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) { setSheet(false); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [sheet, onClose]);

  useEffect(() => {
    const t = player.addListener('timeUpdate', ({ currentTime }) => {
      posRef.current = currentTime;
      const d = player.duration || 0;
      durRef.current = d;
      if (!scrubbing.current) setTime(currentTime);
      setDuration(d);
      if (Math.abs(currentTime - lastSave.current) > 5) {
        lastSave.current = currentTime;
        onProgress(item.uri, currentTime, d);
      }
    });
    const s = player.addListener('statusChange', ({ status: st }) => {
      setStatus(st);
      if (st === 'readyToPlay' && !resumed.current) {
        resumed.current = true;
        const d = player.duration || 0;
        durRef.current = d;
        setDuration(d);
        if (item.pos > 5 && (!d || item.pos < d - 8)) {
          player.currentTime = item.pos;
          showToast(`Resumed at ${fmt(item.pos)}`, 'Start over', () => { player.currentTime = 0; });
        }
      }
    });
    const e = player.addListener('playToEnd', () => {
      setEnded(true);
      setControls(true);
      posRef.current = durRef.current;
      onProgress(item.uri, durRef.current, durRef.current);
    });
    return () => { t.remove(); s.remove(); e.remove(); };
  }, [player]);

  useEffect(() => { if (isPlaying) { setEnded(false); poke(); } else { setControls(true); } }, [isPlaying]);

  /* actions */
  const seekBy = (delta) => {
    const t = clamp(player.currentTime + delta, 0, durRef.current || 1e9);
    player.currentTime = t;
    posRef.current = t;
    setTime(t);
  };

  const togglePlay = () => {
    if (ended) { player.currentTime = 0; setEnded(false); player.play(); return; }
    isPlaying ? player.pause() : player.play();
    poke();
  };

  const changeSpeed = (v) => { setSpeed(v); player.playbackRate = v; setSheet(false); poke(); };
  const toggleMute = () => { player.muted = !muted; setMuted(!muted); poke(); };
  const toggleLoop = () => {
    player.loop = !loop; setLoop(!loop); poke();
    showToast(!loop ? 'Repeat on' : 'Repeat off');
  };
  const cycleFit = () => {
    const n = (fitIdx + 1) % FITS.length;
    setFitIdx(n); poke(); showToast(FITS[n].label);
  };
  const pip = () => { try { videoRef.current?.startPictureInPicture(); } catch {} };

  const flashHud = (kind, v) => {
    setHud({ kind, v });
    clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(null), 700);
  };

  const doRipple = (side) => {
    const now = Date.now();
    const acc = rippleAcc.current;
    acc.total = acc.side === side && now - acc.t < 900 ? acc.total + SEEK : SEEK;
    acc.t = now; acc.side = side;
    seekBy(side === 'left' ? -SEEK : SEEK);
    setRipple({ side, text: `${side === 'left' ? '-' : '+'}${acc.total}s` });
    rippleA.setValue(1);
    Animated.timing(rippleA, { toValue: 0, duration: 700, delay: 150, useNativeDriver: true }).start();
  };

  /* gesture layer: single tap, double tap seek, vertical swipes for brightness/volume */
  const api = useRef({});
  api.current = { locked, poke, setControls, controlsOn, doRipple, flashHud };
  const g = useRef({ x0: 0, mode: null, start: 0, lastTapT: 0, lastTapSide: null }).current;

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { g.x0 = e.nativeEvent.locationX; g.mode = null; },
    onPanResponderMove: (_, gs) => {
      const A = api.current;
      if (A.locked) return;
      if (!g.mode && Math.abs(gs.dy) > 14 && Math.abs(gs.dy) > Math.abs(gs.dx)) {
        g.mode = g.x0 < layer.current.width / 2 ? 'brightness' : 'volume';
        g.start = g.mode === 'brightness' ? bright.current : vol.current;
      }
      if (g.mode) {
        const v = clamp(g.start - gs.dy / (layer.current.height * 0.7));
        if (g.mode === 'brightness') { bright.current = v; Brightness.setBrightnessAsync(v).catch(() => {}); }
        else { vol.current = v; player.volume = v; }
        A.flashHud(g.mode, v);
      }
    },
    onPanResponderRelease: (_, gs) => {
      const A = api.current;
      if (g.mode) { g.mode = null; return; }
      if (Math.abs(gs.dx) > 10 || Math.abs(gs.dy) > 10) return;
      const w = layer.current.width;
      const side = g.x0 < w * 0.38 ? 'left' : g.x0 > w * 0.62 ? 'right' : 'center';
      const now = Date.now();
      if (!A.locked && side !== 'center' && now - g.lastTapT < 300 && g.lastTapSide === side) {
        g.lastTapT = now;
        A.doRipple(side);
        return;
      }
      g.lastTapT = now; g.lastTapSide = side;
      const stamp = now;
      setTimeout(() => {
        if (g.lastTapT !== stamp) return;
        const B = api.current;
        if (B.controlsOn) B.setControls(false); else B.poke();
      }, 290);
    },
  }), []);

  const buffering = status === 'loading';
  const fit = FITS[fitIdx];
  const pad = { paddingHorizontal: Math.max(20, W * 0.04) };

  if (status === 'error') {
    return (
      <View style={p.errorWrap}>
        <StatusBar hidden />
        <View style={p.errorIcon}><Ionicons name="alert" size={28} color={C.danger} /></View>
        <Text style={p.errorTitle}>This video can’t be played</Text>
        <Text style={p.errorBody}>
          The file may have moved, or the link may be offline. Open it again from your phone or check the address.
        </Text>
        <Pressable onPress={onClose} style={[h.btn, { backgroundColor: C.accent, paddingHorizontal: 28, marginTop: 20 }]}>
          <Text style={[h.btnText, { color: C.onAccent }]}>Back to library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={p.root}>
      <StatusBar hidden />
      <VideoView
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit={fit.key}
        allowsPictureInPicture
      />

      {/* gesture layer */}
      <View
        style={StyleSheet.absoluteFill}
        {...pan.panHandlers}
        onLayout={(e) => { layer.current = e.nativeEvent.layout; }}
      />

      {/* double-tap ripple */}
      {ripple && (
        <Animated.View
          pointerEvents="none"
          style={[p.ripple, ripple.side === 'left' ? { left: 0 } : { right: 0 }, { opacity: rippleA }]}
        >
          <Ionicons name={ripple.side === 'left' ? 'play-back' : 'play-forward'} size={30} color="#fff" />
          <Text style={p.rippleText}>{ripple.text}</Text>
        </Animated.View>
      )}

      {/* brightness / volume HUD */}
      {hud && (
        <View pointerEvents="none" style={[p.hud, hud.kind === 'brightness' ? { left: W * 0.12 } : { right: W * 0.12 }]}>
          <Ionicons
            name={hud.kind === 'brightness' ? 'sunny' : hud.v === 0 ? 'volume-mute' : 'volume-high'}
            size={18} color={C.text}
          />
          <View style={p.hudTrack}>
            <View style={[p.hudFill, { height: `${hud.v * 100}%` }]} />
          </View>
          <Text style={p.hudText}>{Math.round(hud.v * 100)}</Text>
        </View>
      )}

      {/* buffering */}
      {buffering && (
        <View pointerEvents="none" style={p.center}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      )}

      {/* controls */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: ctrl }]}
        pointerEvents={controlsOn ? 'box-none' : 'none'}
      >
        {locked ? (
          <View style={p.lockedWrap} pointerEvents="box-none">
            <Pressable onPress={() => { setLocked(false); poke(); }} style={p.unlock}>
              <Ionicons name="lock-closed" size={18} color={C.text} />
              <Text style={p.unlockText}>Tap to unlock</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <LinearGradient pointerEvents="none" colors={['rgba(8,6,16,0.8)', 'transparent']} style={p.topShade} />
            <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(8,6,16,0.88)']} style={p.bottomShade} />

            {/* top bar */}
            <View style={[p.top, pad]} pointerEvents="box-none">
              <RoundBtn icon="chevron-back" onPress={onClose} />
              <Text style={p.title} numberOfLines={1}>{item.title}</Text>
              {Platform.OS === 'android' && <RoundBtn icon="albums-outline" size={20} onPress={pip} />}
              <RoundBtn icon="speedometer-outline" size={20} onPress={() => { setSheet(true); poke(); }} />
            </View>

            {/* centre transport */}
            <View style={p.center} pointerEvents="box-none">
              <View style={p.transport} pointerEvents="box-none">
                <Pressable onPress={() => { seekBy(-SEEK); poke(); }} hitSlop={12} style={p.skip}>
                  <Ionicons name="play-back" size={26} color={C.text} />
                  <Text style={p.skipText}>{SEEK}</Text>
                </Pressable>
                <Pressable onPress={togglePlay} style={p.playBtn} android_ripple={{ color: 'rgba(16,17,43,0.25)', borderless: true }}>
                  <Ionicons
                    name={ended ? 'refresh' : isPlaying ? 'pause' : 'play'}
                    size={34} color={C.onAccent}
                    style={!isPlaying && !ended ? { marginLeft: 4 } : null}
                  />
                </Pressable>
                <Pressable onPress={() => { seekBy(SEEK); poke(); }} hitSlop={12} style={p.skip}>
                  <Ionicons name="play-forward" size={26} color={C.text} />
                  <Text style={p.skipText}>{SEEK}</Text>
                </Pressable>
              </View>
            </View>

            {/* bottom bar */}
            <View style={[p.bottom, pad]} pointerEvents="box-none">
              <Scrubber
                time={time}
                duration={duration}
                onStart={() => { scrubbing.current = true; clearTimeout(hideTimer.current); }}
                onMove={(t) => setTime(t)}
                onEnd={(t) => {
                  scrubbing.current = false;
                  if (t !== null) { player.currentTime = t; posRef.current = t; setTime(t); }
                  poke();
                }}
              />
              <View style={p.bottomRow} pointerEvents="box-none">
                <Text style={p.time}>
                  {fmt(time)}<Text style={p.timeDim}>  /  {fmt(duration)}</Text>
                </Text>
                <View style={p.tools}>
                  <RoundBtn icon={muted ? 'volume-mute' : 'volume-high'} size={20} onPress={toggleMute} active={muted} />
                  <RoundBtn icon="repeat" size={20} onPress={toggleLoop} active={loop} />
                  <RoundBtn icon="scan-outline" size={20} onPress={cycleFit} />
                  <RoundBtn icon="lock-open-outline" size={20} onPress={() => { setLocked(true); setControls(false); showToast('Controls locked'); }} />
                  <Pressable onPress={() => { setSheet(true); poke(); }} style={p.speedChip}>
                    <Text style={p.speedText}>{speed}×</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </>
        )}
      </Animated.View>

      {/* speed sheet */}
      {sheet && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(false)} />
          <View style={[p.sheet, { height: H }]}>
            <Text style={p.sheetTitle}>Playback speed</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {SPEEDS.map((v) => (
                <Pressable key={v} onPress={() => changeSpeed(v)} style={[p.speedRow, v === speed && p.speedRowOn]}>
                  <Text style={[p.speedRowText, v === speed && { color: C.onAccent }]}>
                    {v === 1 ? 'Normal' : `${v}×`}
                  </Text>
                  {v === speed && <Ionicons name="checkmark" size={18} color={C.onAccent} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* toast */}
      {toast && (
        <View style={p.toast} pointerEvents="box-none">
          <Text style={p.toastText}>{toast.text}</Text>
          {toast.action && (
            <Pressable onPress={() => { toast.onAction?.(); setToast(null); }} hitSlop={8}>
              <Text style={p.toastAction}>{toast.action}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/* ───────────────────────── Styles ───────────────────────── */

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 52;

const h = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingTop: topInset + 20, paddingHorizontal: 20, paddingBottom: 48 },
  title: { color: C.text, fontFamily: F.xb, fontSize: 36, letterSpacing: -0.8 },
  sub: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, marginTop: 6, maxWidth: 320 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  btn: { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden' },
  btnText: { fontFamily: F.b, fontSize: 15.5 },

  section: { color: C.text, fontFamily: F.b, fontSize: 18, marginTop: 32, marginBottom: 14 },

  hero: { height: 196, borderRadius: 20, overflow: 'hidden', backgroundColor: C.surface, justifyContent: 'flex-end' },
  heroShade: { ...StyleSheet.absoluteFillObject },
  heroPlay: { position: 'absolute', right: 16, top: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  heroBody: { padding: 16 },
  heroTitle: { color: C.text, fontFamily: F.b, fontSize: 18 },
  heroMeta: { color: 'rgba(241,239,250,0.75)', fontFamily: F.m, fontSize: 13, marginTop: 2, marginBottom: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: C.amber, borderRadius: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderRadius: 14 },
  rowThumb: { width: 116, height: 66 },
  rowTrack: { position: 'absolute', left: 8, right: 8, bottom: 6, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  rowTitle: { color: C.text, fontFamily: F.sb, fontSize: 15, lineHeight: 20 },
  rowMeta: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 3 },
  rowMore: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', marginTop: 64, paddingHorizontal: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: C.text, fontFamily: F.b, fontSize: 19, marginTop: 18 },
  emptyBody: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 6 },
  emptyLink: { color: C.accent, fontFamily: F.b, fontSize: 15, marginTop: 18 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 16 },
  sheetTitle: { color: C.text, fontFamily: F.b, fontSize: 20 },
  sheetSub: { color: C.muted, fontFamily: F.m, fontSize: 14, marginTop: 4, marginBottom: 16 },
  input: { height: 52, borderRadius: 14, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, color: C.text, fontFamily: F.m, fontSize: 15, paddingHorizontal: 16 },
});

const sc = StyleSheet.create({
  hit: { height: 40, justifyContent: 'center' },
  track: { height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.accent },
  thumb: { position: 'absolute', top: 13, width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
  thumbActive: { top: 9, width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, borderWidth: 3, borderColor: '#fff' },
  bubble: { position: 'absolute', top: -34, width: 60, height: 28, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  bubbleText: { color: C.onAccent, fontFamily: F.xb, fontSize: 13, fontVariant: ['tabular-nums'] },
});

const p = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 170 },

  top: { position: 'absolute', top: 14, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: C.text, fontFamily: F.b, fontSize: 16, marginHorizontal: 4 },

  round: { minWidth: 42, height: 42, borderRadius: 21, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  roundLabel: { color: C.text, fontFamily: F.b, fontSize: 10 },

  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 44 },
  playBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  skip: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  skipText: { position: 'absolute', bottom: 7, color: C.muted, fontFamily: F.b, fontSize: 9 },

  bottom: { position: 'absolute', bottom: 12, left: 0, right: 0 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  time: { color: C.text, fontFamily: F.b, fontSize: 14, fontVariant: ['tabular-nums'] },
  timeDim: { color: C.muted, fontFamily: F.m },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speedChip: { height: 42, minWidth: 54, paddingHorizontal: 12, borderRadius: 21, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  speedText: { color: C.text, fontFamily: F.xb, fontSize: 14 },

  lockedWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 28 },
  unlock: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: C.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  unlockText: { color: C.text, fontFamily: F.b, fontSize: 14 },

  ripple: { position: 'absolute', top: 0, bottom: 0, width: '34%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', gap: 4 },
  rippleText: { color: '#fff', fontFamily: F.xb, fontSize: 15 },

  hud: { position: 'absolute', top: '22%', width: 52, height: 150, borderRadius: 26, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  hudTrack: { flex: 1, width: 5, borderRadius: 3, marginVertical: 8, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'flex-end', overflow: 'hidden' },
  hudFill: { width: '100%', backgroundColor: C.accent },
  hudText: { color: C.text, fontFamily: F.b, fontSize: 11, fontVariant: ['tabular-nums'] },

  sheet: { position: 'absolute', right: 0, top: 0, width: 210, backgroundColor: 'rgba(26,23,40,0.97)', paddingTop: 22, paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: C.line },
  sheetTitle: { color: C.text, fontFamily: F.b, fontSize: 16, marginBottom: 12, marginLeft: 6 },
  speedRow: { height: 46, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  speedRowOn: { backgroundColor: C.accent },
  speedRowText: { color: C.text, fontFamily: F.sb, fontSize: 15 },

  toast: { position: 'absolute', left: 28, bottom: 92, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, height: 42, borderRadius: 21, backgroundColor: 'rgba(26,23,40,0.95)', borderWidth: 1, borderColor: C.line },
  toastText: { color: C.text, fontFamily: F.sb, fontSize: 13.5 },
  toastAction: { color: C.accent, fontFamily: F.xb, fontSize: 13.5 },

  errorWrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  errorTitle: { color: C.text, fontFamily: F.b, fontSize: 19, marginTop: 16 },
  errorBody: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 6, maxWidth: 380 },
});
