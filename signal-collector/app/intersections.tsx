import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type LongPressEvent } from 'react-native-maps';
import { router } from 'expo-router';
import { insertIntersection, listIntersections } from '@/database/repositories';
import { refreshIntersectionsFromRemote } from '@/services/syncService';
import { useSessionStore } from '@/stores/sessionStore';
import { getCurrentFix } from '@/services/locationService';
import { intersectionInputSchema } from '@/validation/schemas';
import { newUuid } from '@/utils/ids';
import { haversineMeters, formatDistance } from '@/utils/geo';
import { findSignalAhead } from '@/utils/signalLookup';
import { colors, spacing } from '@/utils/theme';
import type { ApproachDirection, GeoFix, Intersection } from '@/types/models';

const FALLBACK_REGION = {
  latitude: 30.2672,
  longitude: -97.7431,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function IntersectionsScreen() {
  const setDraftIntersection = useSessionStore((s) => s.setDraftIntersection);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [search, setSearch] = useState('');
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setIntersections(listIntersections(search.trim() || undefined));
  }, [search]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    void getCurrentFix().then(setFix);
    void refreshIntersectionsFromRemote().then(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    if (!fix) return intersections;
    return [...intersections]
      .map((ix) => ({
        ix,
        dist: haversineMeters(fix.latitude, fix.longitude, ix.latitude, ix.longitude),
      }))
      .sort((a, b) => a.dist - b.dist)
      .map(({ ix, dist }) => ({ ...ix, __dist: dist }) as Intersection & { __dist: number });
  }, [intersections, fix]);

  const region = fix
    ? { latitude: fix.latitude, longitude: fix.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : FALLBACK_REGION;

  const onLongPress = useCallback((event: LongPressEvent) => {
    setPin(event.nativeEvent.coordinate);
    setShowAddModal(true);
  }, []);

  const saveNewIntersection = useCallback(() => {
    const coords = pin ?? (fix ? { latitude: fix.latitude, longitude: fix.longitude } : null);
    if (!coords) {
      setError('No location available. Drop a pin on the map.');
      return;
    }
    const parsed = intersectionInputSchema.safeParse({
      clientGeneratedId: newUuid(),
      name: newName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      city: newCity.trim() || null,
      state: null,
      timezone: null,
      source: 'user',
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid intersection');
      return;
    }
    const created = insertIntersection(parsed.data);
    setShowAddModal(false);
    setPin(null);
    setNewName('');
    setNewCity('');
    setError(null);
    setDraftIntersection(created);
    router.push('/movement');
  }, [pin, fix, newName, newCity, setDraftIntersection]);

  const choose = useCallback(
    (intersection: Intersection, suggestedDirection: ApproachDirection | null = null) => {
      setDraftIntersection(intersection, suggestedDirection);
      router.push('/movement');
    },
    [setDraftIntersection],
  );

  // Auto-detected signal: nearest within 75 m ahead of the direction of
  // travel (or plain nearest when stationary). Used to pre-fill the session
  // instead of manual labels.
  const suggestion = useMemo(() => {
    if (!fix) return null;
    return findSignalAhead(
      intersections,
      fix.latitude,
      fix.longitude,
      fix.headingDegrees,
    );
  }, [fix, intersections]);

  return (
    <View style={styles.screen}>
      <MapView style={styles.map} initialRegion={region} onLongPress={onLongPress}>
        {sorted.map((ix) => (
          <Marker
            key={ix.clientGeneratedId}
            coordinate={{ latitude: ix.latitude, longitude: ix.longitude }}
            title={ix.name}
            onCalloutPress={() => choose(ix)}
          />
        ))}
        {pin && <Marker coordinate={pin} pinColor="#58a6ff" title="New intersection" />}
      </MapView>
      <Text style={styles.hint}>Long-press the map to add an intersection at that point</Text>

      {suggestion && (
        <Pressable
          style={styles.suggestion}
          onPress={() => choose(suggestion.intersection, suggestion.approachDirection)}
        >
          <Text style={styles.suggestionTitle} numberOfLines={1}>
            📍 {suggestion.intersection.name}
          </Text>
          <Text style={styles.suggestionMeta}>
            {formatDistance(suggestion.distanceMeters)} away
            {suggestion.approachDirection ? ` · ${suggestion.approachDirection}` : ''}
            {suggestion.intersection.maintainingAgency
              ? ` · ${suggestion.intersection.maintainingAgency}`
              : ''}{' '}
            — tap to use
          </Text>
        </Pressable>
      )}

      <TextInput
        style={styles.search}
        placeholder="Search intersections…"
        placeholderTextColor={colors.textDim}
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={sorted}
        keyExtractor={(ix) => ix.clientGeneratedId}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No intersections yet. Long-press the map or use “Add here”.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => choose(item)}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.city ? `${item.city} · ` : ''}
                {'__dist' in item
                  ? formatDistance((item as Intersection & { __dist: number }).__dist)
                  : ''}
              </Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        )}
      />

      <Pressable
        style={styles.addButton}
        onPress={() => {
          setPin(null);
          setShowAddModal(true);
        }}
      >
        <Text style={styles.addLabel}>+ Add intersection at my location</Text>
      </Pressable>

      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New intersection</Text>
            <TextInput
              style={styles.input}
              placeholder="Name, e.g. Congress Ave & 5th St"
              placeholderTextColor={colors.textDim}
              value={newName}
              onChangeText={setNewName}
            />
            <TextInput
              style={styles.input}
              placeholder="City (optional)"
              placeholderTextColor={colors.textDim}
              value={newCity}
              onChangeText={setNewCity}
            />
            <Text style={styles.modalHint}>
              {pin
                ? `Pin: ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`
                : fix
                  ? `Using current GPS: ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`
                  : 'No GPS fix — drop a pin on the map first'}
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={styles.saveButton} onPress={saveNewIntersection}>
              <Text style={styles.saveLabel}>Save & select</Text>
            </Pressable>
            <Pressable
              style={styles.cancelButton}
              onPress={() => {
                setShowAddModal(false);
                setError(null);
              }}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { height: 260 },
  hint: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 4,
  },
  suggestion: {
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  suggestionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  suggestionMeta: { color: colors.accent, fontSize: 12, marginTop: 2 },
  search: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  list: { flex: 1, paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowInfo: { flex: 1 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowChevron: { color: colors.textDim, fontSize: 22 },
  empty: { color: colors.textDim, textAlign: 'center', paddingVertical: spacing.lg },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addLabel: { color: '#04121f', fontWeight: '800', fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.md },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  modalHint: { color: colors.textDim, fontSize: 12, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  saveButton: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  saveLabel: { color: '#04260d', fontWeight: '800', fontSize: 15 },
  cancelButton: { alignItems: 'center', paddingVertical: 10 },
  cancelLabel: { color: colors.textDim },
});
