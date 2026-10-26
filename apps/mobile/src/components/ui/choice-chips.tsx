import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

interface ChipsProps<T extends string | number> {
  label?: string;
  choices: readonly Choice<T>[];
  isSelected: (value: T) => boolean;
  onPress: (value: T) => void;
  multiple: boolean;
}

function Chips<T extends string | number>({ label, choices, isSelected, onPress, multiple }: ChipsProps<T>) {
  const theme = useTheme();
  return (
    <View style={styles.wrapper}>
      {label && <ThemedText type="smallBold">{label}</ThemedText>}
      <View style={styles.row}>
        {choices.map((choice) => {
          const selected = isSelected(choice.value);
          return (
            <Pressable
              key={String(choice.value)}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected }}
              onPress={() => onPress(choice.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? theme.primarySoft : theme.backgroundElement,
                  borderColor: selected ? theme.primary : theme.border,
                },
              ]}
            >
              <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text }}>
                {selected && multiple ? '✓ ' : ''}
                {choice.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Tappable options where exactly one can be chosen (like radio buttons). */
export function ChoiceChips<T extends string | number>({
  value,
  onChange,
  ...rest
}: {
  label?: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return <Chips {...rest} multiple={false} isSelected={(v) => v === value} onPress={onChange} />;
}

/** Tappable options where any number can be chosen (like checkboxes). */
export function MultiChoiceChips<T extends string | number>({
  value,
  onChange,
  ...rest
}: {
  label?: string;
  choices: readonly Choice<T>[];
  value: T[];
  onChange: (value: T[]) => void;
}) {
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return <Chips {...rest} multiple isSelected={(v) => value.includes(v)} onPress={toggle} />;
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: 1,
  },
});
