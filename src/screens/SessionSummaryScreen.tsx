import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type Svg from 'react-native-svg';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { OptionSheet, SelectField } from '../components/OptionSheet';
import { PATTERN_TEXT_MAX, sanitizePatternText } from '../components/pixelFont';
import {
  CARD_SHAPES,
  CARD_WIDTH,
  ShareCard,
  cardHeight,
  isCardPrepared,
  prepareCard,
  textPattern,
  type CardShape,
  type PresetShape,
} from '../components/ShareCard';
import { getSessionSummary } from '../db/repository';
import type { SessionStackParamList } from '../navigation/types';
import { colors, fontSize, radius, spacing, themed } from '../theme';
import type { SessionSummary } from '../types';
import { formatDateDisplay } from '../utils/date';
import { formatVolume, formatWeight } from '../utils/format';
import { muscleLabel, t, tn } from '../i18n';

type Props = NativeStackScreenProps<SessionStackParamList, 'SessionSummary'>;

type PatternChoice = PresetShape | 'custom';
const CUSTOM = 'custom';

/** Remembered for the rest of the app session so the next card opens with the pattern you last picked. */
let lastChoice: PatternChoice = 'dumbbell';
let lastCustomText = '';

function summaryToText(summary: SessionSummary): string {
  const lines: string[] = [];
  lines.push(`BUKU BESI — ${summary.name || t('WORKOUT')}`);
  lines.push(formatDateDisplay(summary.date));
  lines.push('');
  lines.push(
    [
      t('{v} kg volume', { v: formatVolume(summary.volume) }),
      tn(summary.setCount, '{n} set', '{n} sets'),
      tn(summary.exerciseCount, '{n} exercise', '{n} exercises'),
    ].join(' · ')
  );
  if (summary.muscleGroups.length > 0) lines.push(summary.muscleGroups.map(muscleLabel).join(' · '));
  lines.push('');
  for (const ex of summary.exercises) {
    const bits = [ex.name];
    if (ex.machine) bits.push(`(${ex.machine})`);
    let line = `${bits.join(' ')} — ${ex.topSet}`;
    if (ex.isPR) line += `  PR${ex.prDelta !== null ? ` +${formatWeight(ex.prDelta)}` : ''}`;
    lines.push(line);
  }
  return lines.join('\n');
}

export function SessionSummaryScreen({ route }: Props) {
  const { sessionId } = route.params;
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [busy, setBusy] = useState<'share' | 'copy' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [scrim, setScrim] = useState(true);
  const [choice, setChoiceState] = useState<PatternChoice>(lastChoice);
  const [customText, setCustomTextState] = useState(lastCustomText);
  const [pickingPattern, setPickingPattern] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [builtFor, setBuiltFor] = useState<{ summary: SessionSummary; shape: CardShape } | null>(null);
  const svgRef = useRef<React.ElementRef<typeof Svg> | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  useFocusEffect(
    useCallback(() => {
      getSessionSummary(sessionId).then(setSummary);
    }, [sessionId])
  );

  function setChoice(next: PatternChoice) {
    lastChoice = next;
    setChoiceState(next);
  }

  function setCustomText(raw: string) {
    const next = sanitizePatternText(raw);
    lastCustomText = next;
    setCustomTextState(next);
  }

  const customValid = customText.trim() !== '';
  const shape: CardShape | null = choice === CUSTOM ? (customValid ? textPattern(customText) : null) : choice;

  // The word-art layout is a real search (~0.5–1 s on Hermes for a big session) and it
  // used to start as soon as this screen opened, which made the first second after
  // opening laggy. Now nothing heavy runs until you ask for it.
  function generate() {
    if (!summary || !shape || generating) return;
    setGenerating(true);
    // Let the spinner paint before the search ties up the JS thread.
    setTimeout(() => {
      prepareCard(summary, shape);
      setBuiltFor({ summary, shape });
      setGenerating(false);
    }, 50);
  }

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(id);
  }, [status]);

  /** Rasterise the SVG card to raw base64 PNG (no data: prefix). */
  function captureBase64(): Promise<string> {
    const node = svgRef.current;
    if (!node || !summary) return Promise.reject(new Error(t('The card is not ready yet.')));
    if (!shape) return Promise.reject(new Error(t('The card is not ready yet.')));
    const height = cardHeight(summary, shape);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t('Rendering the image timed out.'))), 10000);
      try {
        node.toDataURL(
          (data: string) => {
            clearTimeout(timer);
            resolve(data.replace(/^data:image\/png;base64,/, ''));
          },
          { width: CARD_WIDTH, height }
        );
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  async function handleShareImage() {
    if (!summary) return;
    setBusy('share');
    setStatus(null);
    try {
      const base64 = await captureBase64();
      const file = new File(Paths.cache, `buku-besi-${summary.date}.png`);
      if (file.exists) file.delete();
      file.create();
      file.write(base64, { encoding: 'base64' });

      if (!(await Sharing.isAvailableAsync())) throw new Error(t('Sharing is not available on this device.'));
      await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: t('Share workout'), UTI: 'public.png' });
    } catch (e) {
      Alert.alert(t('Could not share image'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyImage() {
    if (!summary) return;
    setBusy('copy');
    setStatus(null);
    try {
      await Clipboard.setImageAsync(await captureBase64());
      setStatus(t('Image copied — long-press and paste it into any app that takes images.'));
    } catch (e) {
      Alert.alert(t('Could not copy image'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleShareText() {
    if (!summary) return;
    try {
      await Share.share({ message: summaryToText(summary) });
    } catch (e) {
      Alert.alert(t('Could not share'), String(e));
    }
  }

  async function handleCopyText() {
    if (!summary) return;
    try {
      await Clipboard.setStringAsync(summaryToText(summary));
      setStatus(t('Stats copied as text.'));
    } catch (e) {
      Alert.alert(t('Could not copy'), String(e));
    }
  }

  if (!summary) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>{t('Loading…')}</Text>
      </View>
    );
  }

  const previewWidth = screenWidth - spacing.md * 2 - spacing.md * 2;
  const scale = previewWidth / CARD_WIDTH;
  // A pattern built earlier in this visit shows straight away; anything else waits for Generate.
  const cardReady =
    shape !== null && ((builtFor?.summary === summary && builtFor.shape === shape) || isCardPrepared(summary, shape));
  const fullHeight = cardReady && shape ? cardHeight(summary, shape) : 0;
  const patternLabel = choice === CUSTOM ? t('Custom text…') : t(CARD_SHAPES.find((s) => s.id === choice)?.label ?? '');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <CardTitle
            title={t('Shareable card')}
            right={
              <View style={styles.segment}>
                {([true, false] as const).map((value) => (
                  <Pressable
                    key={String(value)}
                    style={[styles.segmentBtn, scrim === value && styles.segmentBtnActive]}
                    onPress={() => setScrim(value)}
                  >
                    <Text style={[styles.segmentText, scrim === value && styles.segmentTextActive]}>
                      {value ? t('PANEL') : t('CLEAR')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            }
          />
          <Text style={styles.hint}>
            {scrim
              ? t('PNG with a see-through dark panel — the photo shows through but the text stays readable.')
              : t('Fully transparent PNG. Best over a dark photo; white text can disappear on a light one.')}
          </Text>
          <SelectField
            label={t('PATTERN')}
            value={patternLabel}
            icon="shapes-outline"
            style={styles.patternField}
            onPress={() => setPickingPattern(true)}
          />
          {choice === CUSTOM && (
            <View style={styles.customWrap}>
              <TextInput
                style={styles.customInput}
                value={customText}
                onChangeText={setCustomText}
                placeholder={t('E.G. PUSH')}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={PATTERN_TEXT_MAX}
                returnKeyType="done"
                onSubmitEditing={generate}
              />
              <Text style={styles.customCount}>
                {customText.length}/{PATTERN_TEXT_MAX}
              </Text>
            </View>
          )}
          {choice === CUSTOM && <Text style={styles.customHint}>{t('Letters A–Z, numbers, ! and -. Your exercises fill the letters.')}</Text>}
          <View style={styles.previewFrame}>
            {cardReady ? (
              <>
                <View style={[styles.checkerboard, { height: fullHeight * scale }]}>
                  {Array.from({ length: Math.ceil((fullHeight * scale) / 24) }).map((_, row) => (
                    <View key={row} style={styles.checkRow}>
                      {Array.from({ length: Math.ceil(previewWidth / 24) }).map((__, col) => (
                        <View key={col} style={[styles.checkCell, (row + col) % 2 === 0 && styles.checkCellAlt]} />
                      ))}
                    </View>
                  ))}
                </View>
                <View style={[styles.previewClip, { width: previewWidth, height: fullHeight * scale }]}>
                  <View style={{ width: CARD_WIDTH, height: fullHeight, transform: [{ scale }], transformOrigin: 'top left' }}>
                    <ShareCard ref={svgRef} summary={summary} shape={shape!} width={CARD_WIDTH} height={fullHeight} scrim={scrim} />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.building}>
                {generating ? (
                  <>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.buildingText}>{t('Building your card…')}</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="color-wand-outline" size={28} color={colors.primary} />
                    <Text style={styles.buildingText}>
                      {shape ? t('Pick a pattern, then build the card.') : t('Type up to {n} characters for your pattern.', { n: PATTERN_TEXT_MAX })}
                    </Text>
                    <View style={styles.generateBtn}>
                      <Button title={t('Generate card')} icon="sparkles-outline" onPress={generate} disabled={!shape} />
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </Card>

        <View style={styles.actions}>
          {status && (
            <View style={styles.statusPill}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.statusText}>{status}</Text>
            </View>
          )}
          <View style={styles.actionRow}>
            <View style={styles.actionCell}>
              <Button title={t('Copy image')} icon="copy-outline" onPress={handleCopyImage} loading={busy === 'copy'} disabled={!cardReady} />
            </View>
            <View style={styles.actionCell}>
              <Button title={t('Share image')} variant="secondary" icon="share-outline" onPress={handleShareImage} loading={busy === 'share'} disabled={!cardReady} />
            </View>
          </View>
          <View style={styles.gap} />
          <View style={styles.actionRow}>
            <View style={styles.actionCell}>
              <Button title={t('Copy text')} variant="secondary" icon="clipboard-outline" onPress={handleCopyText} />
            </View>
            <View style={styles.actionCell}>
              <Button title={t('Share text')} variant="secondary" icon="text-outline" onPress={handleShareText} />
            </View>
          </View>
        </View>

        <Card>
          <CardTitle title={t('Breakdown')} />
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatVolume(summary.volume)}</Text>
              <Text style={styles.statLabel}>{t('VOLUME (KG)')}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{summary.setCount}</Text>
              <Text style={styles.statLabel}>{t('SETS')}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{summary.workingSets}</Text>
              <Text style={styles.statLabel}>{t('WORKING')}</Text>
            </View>
          </View>
          {summary.exercises.map((ex, i) => (
            <View key={`${ex.name}-${i}`} style={[styles.exRow, i === summary.exercises.length - 1 && styles.exRowLast]}>
              <View style={styles.exLeft}>
                <Text style={styles.exName}>{ex.name}</Text>
                {(ex.machine || ex.muscleGroup) && (
                  <Text style={styles.exSub}>{[ex.machine, ex.muscleGroup ? muscleLabel(ex.muscleGroup) : ''].filter(Boolean).join(' · ')}</Text>
                )}
              </View>
              {ex.isPR && (
                <View style={styles.prBadge}>
                  <Ionicons name="trophy" size={11} color={colors.primary} />
                  <Text style={styles.prText}>{ex.prDelta !== null ? `+${formatWeight(ex.prDelta)}` : 'PR'}</Text>
                </View>
              )}
              <Text style={[styles.exSet, ex.isPR && styles.exSetPr]}>{ex.topSet}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      <OptionSheet
        visible={pickingPattern}
        title={t('Pattern')}
        options={[
          ...CARD_SHAPES.map((s) => ({ value: s.id, label: t(s.label) })),
          { value: CUSTOM, label: t('Custom text…'), sub: t('Your own word, up to {n} characters', { n: PATTERN_TEXT_MAX }) },
        ]}
        selected={choice}
        onClose={() => setPickingPattern(false)}
        onSelect={(v) => {
          setChoice(v as PatternChoice);
          setPickingPattern(false);
        }}
      />
    </View>
  );
}

const styles = themed(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    color: colors.textMuted,
    padding: spacing.md,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.small,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 2,
  },
  segmentBtn: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  segmentBtnActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: fontSize.tiny,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  segmentTextActive: {
    color: colors.primaryText,
  },
  patternField: {
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
  },
  customWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  customInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '800',
    letterSpacing: 3,
    paddingVertical: spacing.sm + 2,
  },
  customCount: {
    color: colors.textFaint,
    fontSize: fontSize.tiny,
    fontWeight: '800',
  },
  customHint: {
    color: colors.textFaint,
    fontSize: fontSize.tiny,
    marginBottom: spacing.sm,
  },
  generateBtn: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  previewFrame: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  checkerboard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  checkRow: {
    flexDirection: 'row',
    height: 24,
  },
  checkCell: {
    width: 24,
    height: 24,
    backgroundColor: '#20242e',
  },
  checkCellAlt: {
    backgroundColor: '#171a22',
  },
  building: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  buildingText: {
    color: colors.textMuted,
    fontSize: fontSize.small,
    fontWeight: '700',
  },
  previewClip: {
    overflow: 'hidden',
  },
  actions: {
    marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionCell: {
    flex: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  statusText: {
    flex: 1,
    color: colors.success,
    fontSize: fontSize.small,
    fontWeight: '700',
    lineHeight: 18,
  },
  gap: {
    height: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    letterSpacing: 1,
  },
  exRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  exRowLast: {
    borderBottomWidth: 0,
  },
  exLeft: {
    flex: 1,
  },
  exName: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  exSub: {
    color: colors.textFaint,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  prText: {
    color: colors.primary,
    fontSize: fontSize.tiny,
    fontWeight: '800',
  },
  exSet: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  exSetPr: {
    color: colors.primary,
  },
}));
