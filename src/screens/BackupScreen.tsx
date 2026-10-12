import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { exportAllSessions, mergeData, replaceAllData } from '../db/repository';
import { t, tn, type Language } from '../i18n';
import { usePrefs } from '../prefs';
import { ACCENTS, BACKGROUNDS, colors, fontSize, radius, spacing, themed, type AccentName, type BackgroundName } from '../theme';
import { parseBackup } from '../utils/backup';
import { todayString } from '../utils/date';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function SectionIcon({ name }: { name: IconName }) {
  return (
    <View style={styles.sectionIcon}>
      <Ionicons name={name} size={20} color={colors.primary} />
    </View>
  );
}

const LANGUAGES: { id: Language; label: string; sub: string }[] = [
  { id: 'en', label: 'English', sub: 'ENGLISH' },
  { id: 'ms', label: 'Bahasa Melayu', sub: 'MALAY' },
];

const BACKGROUND_LABELS: Record<BackgroundName, string> = {
  dark: 'Dark',
  black: 'Pitch black',
  navy: 'Navy',
  plum: 'Plum',
};

function SettingsCards() {
  const { prefs, update } = usePrefs();
  return (
    <>
      <Card>
        <CardTitle title={t('Language')} />
        <View style={styles.langRow}>
          {LANGUAGES.map((l) => {
            const active = prefs.language === l.id;
            return (
              <Pressable key={l.id} style={[styles.langBtn, active && styles.optionActive]} onPress={() => update({ language: l.id })}>
                <Text style={[styles.langLabel, active && styles.optionTextActive]}>{l.label}</Text>
                <Text style={styles.langSub}>{l.sub}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <CardTitle title={t('Accent colour')} />
        <View style={styles.swatchRow}>
          {(Object.keys(ACCENTS) as AccentName[]).map((name) => {
            const active = prefs.accent === name;
            return (
              <Pressable
                key={name}
                accessibilityLabel={name}
                style={[styles.swatchRing, active && { borderColor: ACCENTS[name] }]}
                onPress={() => update({ accent: name })}
              >
                <View style={[styles.swatch, { backgroundColor: ACCENTS[name] }]}>
                  {active && <Ionicons name="checkmark" size={18} color={colors.primaryText} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.subLabel}>{t('BACKGROUND')}</Text>
        <View style={styles.bgRow}>
          {(Object.keys(BACKGROUNDS) as BackgroundName[]).map((name) => {
            const bg = BACKGROUNDS[name];
            const active = prefs.background === name;
            return (
              <Pressable key={name} style={[styles.bgTile, active && styles.optionActive]} onPress={() => update({ background: name })}>
                <View style={[styles.bgPreview, { backgroundColor: bg.background, borderColor: bg.border }]}>
                  <View style={[styles.bgPreviewCard, { backgroundColor: bg.surface }]}>
                    <View style={[styles.bgPreviewDot, { backgroundColor: colors.primary }]} />
                  </View>
                </View>
                <Text style={[styles.bgLabel, active && styles.optionTextActive]}>{t(BACKGROUND_LABELS[name])}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
    </>
  );
}

export function BackupScreen() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setStatus(null);
    try {
      const sessions = await exportAllSessions();
      const payload = sessions.map(({ id: _id, ...rest }) => rest);
      const file = new File(Paths.cache, `buku-besi-backup-${todayString()}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(t('Sharing is not available on this device.'));
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: t('Save Buku Besi backup'),
        UTI: 'public.json',
      });
      setStatus(tn(payload.length, 'Exported {n} session.', 'Exported {n} sessions.'));
    } catch (e) {
      Alert.alert(t('Export failed'), String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    setStatus(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setImporting(true);
    try {
      const text = await new File(result.assets[0].uri).text();
      const sessions = parseBackup(JSON.parse(text));

      Alert.alert(
        t('Import backup'),
        tn(
          sessions.length,
          'Found {n} session. Merge it into your existing data, or replace everything?',
          'Found {n} sessions. Merge them into your existing data, or replace everything?'
        ),
        [
          { text: t('Cancel'), style: 'cancel', onPress: () => setImporting(false) },
          {
            text: t('Merge'),
            onPress: async () => {
              try {
                await mergeData(sessions);
                setStatus(tn(sessions.length, 'Merged {n} session.', 'Merged {n} sessions.'));
              } catch (e) {
                Alert.alert(t('Import failed'), String(e));
              } finally {
                setImporting(false);
              }
            },
          },
          {
            text: t('Replace all'),
            style: 'destructive',
            onPress: async () => {
              try {
                await replaceAllData(sessions);
                setStatus(tn(sessions.length, 'Replaced all data with {n} session.', 'Replaced all data with {n} sessions.'));
              } catch (e) {
                Alert.alert(t('Import failed'), String(e));
              } finally {
                setImporting(false);
              }
            },
          },
        ]
      );
    } catch (e) {
      setImporting(false);
      Alert.alert(t('Import failed'), e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('Settings')} subtitle={t('Language, colours and backup')} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsCards />

        {status && (
          <View style={styles.statusPill}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}

        <Card>
          <View style={styles.cardHeader}>
            <SectionIcon name="cloud-upload-outline" />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>{t('Export')}</Text>
              <Text style={styles.cardBody}>
                {t(
                  'Saves every session to a JSON file and opens the share sheet so you can send it to Drive, Files, or anywhere else. Your data never leaves this phone unless you export it.'
                )}
              </Text>
            </View>
          </View>
          <Button title={t('Export to JSON')} icon="share-outline" onPress={handleExport} loading={exporting} />
        </Card>

        <Card>
          <View style={styles.cardHeader}>
            <SectionIcon name="cloud-download-outline" />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>{t('Import / restore')}</Text>
              <Text style={styles.cardBody}>
                {t(
                  "Pick a previously exported JSON file. You'll be asked whether to merge it into your existing data or replace everything."
                )}
              </Text>
            </View>
          </View>
          <Button title={t('Import from JSON')} variant="secondary" icon="folder-open-outline" onPress={handleImport} loading={importing} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  statusText: {
    color: colors.success,
    fontSize: fontSize.small,
    fontWeight: '700',
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  langBtn: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  optionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  optionTextActive: {
    color: colors.primary,
  },
  langLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  langSub: {
    color: colors.textFaint,
    fontSize: fontSize.tiny,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatchRing: {
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subLabel: {
    color: colors.textFaint,
    fontSize: fontSize.tiny,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  bgRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bgTile: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  bgPreview: {
    width: '100%',
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 6,
    justifyContent: 'flex-end',
  },
  bgPreviewCard: {
    height: 16,
    borderRadius: 5,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  bgPreviewDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  bgLabel: {
    color: colors.textMuted,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    marginTop: spacing.xs + 2,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: fontSize.small,
    lineHeight: 19,
  },
}));
