import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Plus, Trash2 } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { useCreateInvoice } from '../../hooks/useInvoices'
import { useClients } from '../../hooks/useClients'
import { useProjects } from '../../hooks/useProjects'
import { colors } from '../../theme/colors'
import { spacing } from '../../theme/spacing'
import type { MoreStackParamList } from '../../types/navigation'

type Props = { navigation: NativeStackNavigationProp<MoreStackParamList, 'CreateInvoice'> }

interface LineItem {
  key: string
  description: string
  quantity: string
  rate: string
}

export function CreateInvoiceScreen({ navigation }: Props) {
  const createMutation = useCreateInvoice()
  const { data: clientsData } = useClients()
  const { data: projectsData } = useProjects()

  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  // Lazy initialiser — evaluating Date.now() inline runs on every render and
  // makes the first render non-deterministic.
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [taxRate, setTaxRate] = useState('0')
  const [notes, setNotes] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ key: '1', description: '', quantity: '1', rate: '' }])

  const clients = clientsData?.clients ?? []
  const projects = projectsData?.projects ?? []
  const filteredProjects = clientId ? projects.filter(p => p.clientId === clientId) : projects

  const addLineItem = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setItems(prev => [...prev, { key: String(Date.now()), description: '', quantity: '1', rate: '' }])
  }

  const removeLineItem = (key: string) => {
    if (items.length <= 1) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setItems(prev => prev.filter(i => i.key !== key))
  }

  const updateLineItem = (key: string, field: keyof LineItem, value: string) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: value } : i))
  }

  const subtotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0
    const rate = parseFloat(item.rate) || 0
    return sum + qty * rate
  }, 0)

  const tax = subtotal * (parseFloat(taxRate) || 0) / 100
  const total = subtotal + tax

  const handleCreate = async () => {
    if (!clientId) return Alert.alert('Missing Client', 'Please select a client.')
    const validItems = items.filter(i => i.description && i.rate)
    if (validItems.length === 0) return Alert.alert('Missing Items', 'Add at least one line item with a description and rate.')

    try {
      await createMutation.mutateAsync({
        clientId,
        projectId: projectId || undefined,
        dueDate: dueDate.toISOString(),
        taxRate: parseFloat(taxRate) || 0,
        notes: notes || undefined,
        fromName: fromName || undefined,
        fromEmail: fromEmail || undefined,
        items: validItems.map(i => ({
          description: i.description,
          quantity: parseFloat(i.quantity) || 1,
          rate: parseFloat(i.rate) || 0,
        })),
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      navigation.goBack()
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create invoice')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Client *</Text>
          <View style={styles.pickerRow}>
            {clients.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, clientId === c.id && styles.chipActive]}
                onPress={() => { setClientId(c.id); setProjectId('') }}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, clientId === c.id && styles.chipTextActive]} numberOfLines={1}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {filteredProjects.length > 0 && (
            <>
              <Text style={styles.label}>Project (optional)</Text>
              <View style={styles.pickerRow}>
                <TouchableOpacity
                  style={[styles.chip, !projectId && styles.chipActive]}
                  onPress={() => setProjectId('')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, !projectId && styles.chipTextActive]}>None</Text>
                </TouchableOpacity>
                {filteredProjects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, projectId === p.id && styles.chipActive]}
                    onPress={() => setProjectId(p.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Due Date</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <Text style={styles.inputText}>{dueDate.toLocaleDateString()}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dueDate}
              mode="date"
              onChange={(_, date) => { setShowDatePicker(false); if (date) setDueDate(date) }}
            />
          )}

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>From Name</Text>
              <TextInput style={styles.input} value={fromName} onChangeText={setFromName} placeholder="Your name" placeholderTextColor={colors.textSecondary} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>From Email</Text>
              <TextInput style={styles.input} value={fromEmail} onChangeText={setFromEmail} placeholder="you@email.com" placeholderTextColor={colors.textSecondary} keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Line Items</Text>
            <TouchableOpacity onPress={addLineItem} hitSlop={8} activeOpacity={0.7}>
              <Plus size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={item.key} style={styles.lineItem}>
              <View style={styles.lineItemHeader}>
                <Text style={styles.lineItemLabel}>Item {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeLineItem(item.key)} hitSlop={8} activeOpacity={0.7}>
                    <Trash2 size={18} color={colors.destructive} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.input}
                value={item.description}
                onChangeText={v => updateLineItem(item.key, 'description', v)}
                placeholder="Description"
                placeholderTextColor={colors.textSecondary}
              />
              <View style={styles.row}>
                <View style={styles.halfField}>
                  <TextInput
                    style={styles.input}
                    value={item.quantity}
                    onChangeText={v => updateLineItem(item.key, 'quantity', v)}
                    placeholder="Qty"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.halfField}>
                  <TextInput
                    style={styles.input}
                    value={item.rate}
                    onChangeText={v => updateLineItem(item.key, 'rate', v)}
                    placeholder="Rate ($)"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}

          <Text style={styles.label}>Tax Rate (%)</Text>
          <TextInput
            style={styles.input}
            value={taxRate}
            onChangeText={setTaxRate}
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Payment terms, thank you note..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={3}
          />

          <View style={styles.totalsSection}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>${subtotal.toFixed(2)}</Text>
            </View>
            {tax > 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
                <Text style={styles.totalValue}>${tax.toFixed(2)}</Text>
              </View>
            )}
            <View style={[styles.totalLine, styles.grandTotal]}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>${total.toFixed(2)}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.createButton, createMutation.isPending && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={createMutation.isPending}
            activeOpacity={0.7}
          >
            <Text style={styles.createButtonText}>
              {createMutation.isPending ? 'Creating...' : 'Create Invoice'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.lg },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: spacing.lg,
    color: colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: colors.border,
  },
  inputText: { fontSize: 15, color: colors.textPrimary },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary + '15', borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textSecondary },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.md },
  halfField: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  lineItem: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, gap: spacing.sm,
  },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineItemLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  totalsSection: {
    marginTop: spacing.xl, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  totalLabel: { fontSize: 15, color: colors.textSecondary },
  totalValue: { fontSize: 15, color: colors.textPrimary },
  grandTotal: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  grandTotalLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  grandTotalValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  createButton: {
    backgroundColor: colors.primary, borderRadius: 10, padding: spacing.lg,
    alignItems: 'center', marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  createButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
