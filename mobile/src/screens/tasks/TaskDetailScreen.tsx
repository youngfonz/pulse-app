import React, { useLayoutEffect, useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  useTaskDetail,
  useUpdateTask,
  useDeleteTask,
  useToggleTask,
  useAddComment,
} from '../../hooks/useTasks'
import { useUser } from '@clerk/expo'
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed'
import { VoiceMicButton } from '../../components/ui/VoiceMicButton'
import { colors } from '../../theme/colors'
import { spacing } from '../../theme/spacing'
import { getStatusLabel, getStatusColor, getPriorityColor } from '../../utils/status'
import { formatDate } from '../../utils/dates'
import type { TasksStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<TasksStackParamList, 'TaskDetail'>

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export function TaskDetailScreen({ route, navigation }: Props) {
  const { id } = route.params
  const { data: task, isLoading, isRefetching, refetch } = useTaskDetail(id)
  const { user } = useUser()
  const { addItem } = useRecentlyViewed(user?.id)

  useEffect(() => {
    if (task) {
      addItem({ id: task.id, type: 'task', name: task.title, subtitle: task.project?.name ?? 'Quick task' })
    }
  }, [task?.id])

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const toggleTask = useToggleTask()
  const addComment = useAddComment()

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Due date editing
  const [isEditingDue, setIsEditingDue] = useState(false)
  const [editDueDate, setEditDueDate] = useState('')

  // Comment input
  const [commentText, setCommentText] = useState('')

  // Wire up header Edit / Save / Cancel buttons
  useLayoutEffect(() => {
    if (!task) return

    if (isEditing) {
      navigation.setOptions({
        headerRight: () => (
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleCancelEdit} style={styles.headerBtn} activeOpacity={0.7}>
              <Text style={styles.headerBtnCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveEdit}
              style={styles.headerBtn}
              disabled={updateTask.isPending}
              activeOpacity={0.7}
            >
              <Text style={styles.headerBtnSave}>
                {updateTask.isPending ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        ),
      })
    } else {
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity onPress={handleStartEdit} style={styles.headerBtn} activeOpacity={0.7}>
            <Text style={styles.headerBtnSave}>Edit</Text>
          </TouchableOpacity>
        ),
      })
    }
  }, [isEditing, task, updateTask.isPending])

  function handleStartEdit() {
    if (!task) return
    setEditTitle(task.title)
    setEditDescription(task.description ?? '')
    setIsEditing(true)
  }

  function handleCancelEdit() {
    setIsEditing(false)
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) {
      Alert.alert('Validation', 'Title cannot be empty.')
      return
    }
    await updateTask.mutateAsync({
      id,
      data: { title: editTitle.trim(), description: editDescription.trim() || null },
    })
    setIsEditing(false)
  }

  async function handleToggle() {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    toggleTask.mutate(id)
  }

  async function handleStatusChange(status: string) {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    updateTask.mutate({ id, data: { status } })
  }

  async function handlePriorityChange(priority: string) {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    updateTask.mutate({ id, data: { priority } })
  }

  function handleDueTap() {
    setEditDueDate(task?.dueDate ? task.dueDate.substring(0, 10) : '')
    setIsEditingDue(true)
  }

  async function handleDueSave() {
    const trimmed = editDueDate.trim()
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert('Invalid date', 'Enter a date in YYYY-MM-DD format, or leave blank to clear.')
      return
    }
    await updateTask.mutateAsync({ id, data: { dueDate: trimmed || null } })
    setIsEditingDue(false)
  }

  function handleDueClear() {
    updateTask.mutate({ id, data: { dueDate: null } })
    setIsEditingDue(false)
  }

  function handleDelete() {
    Alert.alert(
      'Delete Task',
      'Are you sure you want to delete this task? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTask.mutateAsync(id)
            navigation.goBack()
          },
        },
      ]
    )
  }

  async function handleAddComment() {
    const content = commentText.trim()
    if (!content) return
    await addComment.mutateAsync({ taskId: id, content })
    setCommentText('')
  }

  useEffect(() => {
    if (!task && !isLoading) {
      navigation.goBack()
    }
  }, [task, isLoading, navigation])

  if (isLoading && !task) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!task && !isLoading) {
    return null
  }

  const isCompleted = task?.status === 'done' || task?.status === 'completed'

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          keyboardShouldPersistTaps="handled"
        >
          {task && (
            <>
              {/* Toggle completion */}
              <TouchableOpacity
                style={[styles.toggleBtn, isCompleted ? styles.toggleBtnMuted : styles.toggleBtnGreen]}
                onPress={handleToggle}
                disabled={toggleTask.isPending}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, isCompleted ? styles.toggleBtnTextMuted : styles.toggleBtnTextGreen]}>
                  {toggleTask.isPending
                    ? 'Updating…'
                    : isCompleted
                    ? 'Mark Incomplete'
                    : 'Mark Complete'}
                </Text>
              </TouchableOpacity>

              {/* Title */}
              {isEditing ? (
                <TextInput
                  style={styles.titleInput}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Task title"
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                  returnKeyType="done"
                />
              ) : (
                <Text style={[styles.title, isCompleted && styles.titleCompleted]}>{task.title}</Text>
              )}

              {task.project && <Text style={styles.project}>{task.project.name}</Text>}

              {/* Status picker */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Status</Text>
                <View style={styles.chipRow}>
                  {STATUS_OPTIONS.map(opt => {
                    const active = task.status === opt.value
                    const chipColor = getStatusColor(opt.value)
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          active
                            ? { backgroundColor: chipColor, borderColor: chipColor }
                            : { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                        onPress={() => !active && handleStatusChange(opt.value)}
                        disabled={updateTask.isPending}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, { color: active ? '#fff' : colors.textSecondary }]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              {/* Priority picker */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Priority</Text>
                <View style={styles.chipRow}>
                  {PRIORITY_OPTIONS.map(opt => {
                    const active = task.priority === opt.value
                    const chipColor = getPriorityColor(opt.value)
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          active
                            ? { backgroundColor: chipColor, borderColor: chipColor }
                            : { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                        onPress={() => !active && handlePriorityChange(opt.value)}
                        disabled={updateTask.isPending}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, { color: active ? '#fff' : colors.textSecondary }]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              {/* Due date */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Due Date</Text>
                {isEditingDue ? (
                  <View style={styles.dueDateEditRow}>
                    <TextInput
                      style={styles.dueDateInput}
                      value={editDueDate}
                      onChangeText={setEditDueDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numbers-and-punctuation"
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handleDueSave}
                    />
                    <TouchableOpacity style={styles.dueDateSaveBtn} onPress={handleDueSave} disabled={updateTask.isPending} activeOpacity={0.7}>
                      <Text style={styles.dueDateSaveBtnText}>Set</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dueDateClearBtn} onPress={handleDueClear} disabled={updateTask.isPending} activeOpacity={0.7}>
                      <Text style={styles.dueDateClearBtnText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={handleDueTap} activeOpacity={0.7}>
                    <Text style={task.dueDate ? styles.dueDateText : styles.dueDateEmpty}>
                      {task.dueDate ? formatDate(task.dueDate) : 'Tap to set a due date'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Description */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Description</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.descriptionInput}
                    value={editDescription}
                    onChangeText={setEditDescription}
                    placeholder="Add a description…"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    textAlignVertical="top"
                  />
                ) : task.description ? (
                  <Text style={styles.body}>{task.description}</Text>
                ) : (
                  <Text style={styles.bodyEmpty}>No description</Text>
                )}
              </View>

              {task.notes && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Notes</Text>
                  <Text style={styles.body}>{task.notes}</Text>
                </View>
              )}

              {/* Comments */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Comments{task.comments && task.comments.length > 0 ? ` (${task.comments.length})` : ''}
                </Text>

                {task.comments && task.comments.length > 0 ? (
                  task.comments.map(c => (
                    <View key={c.id} style={styles.comment}>
                      <Text style={styles.commentText}>{c.content}</Text>
                      <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.bodyEmpty}>No comments yet</Text>
                )}

                {/* Add comment input */}
                <View style={styles.commentInputRow}>
                  <TextInput
                    style={styles.commentInput}
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="Add a comment…"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    returnKeyType="send"
                    blurOnSubmit
                    onSubmitEditing={handleAddComment}
                  />
                  <VoiceMicButton
                    size={34}
                    onTranscript={(text) => setCommentText((prev) => prev ? `${prev} ${text}` : text)}
                  />
                  <TouchableOpacity
                    style={[
                      styles.commentSendBtn,
                      (!commentText.trim() || addComment.isPending) && styles.commentSendBtnDisabled,
                    ]}
                    onPress={handleAddComment}
                    disabled={!commentText.trim() || addComment.isPending}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.commentSendBtnText}>
                      {addComment.isPending ? '…' : 'Post'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Delete */}
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={handleDelete}
                disabled={deleteTask.isPending}
                activeOpacity={0.7}
              >
                <Text style={styles.deleteBtnText}>
                  {deleteTask.isPending ? 'Deleting…' : 'Delete Task'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, fontSize: 15 },

  // Header actions
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerBtn: { paddingHorizontal: 2 },
  headerBtnSave: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  headerBtnCancel: { fontSize: 16, color: colors.textSecondary },

  // Toggle completion button
  toggleBtn: {
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1.5,
  },
  toggleBtnGreen: {
    backgroundColor: colors.success + '15',
    borderColor: colors.success,
  },
  toggleBtnMuted: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  toggleBtnText: { fontSize: 15, fontWeight: '600' },
  toggleBtnTextGreen: { color: colors.success },
  toggleBtnTextMuted: { color: colors.textSecondary },

  // Title
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  titleCompleted: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  titleInput: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },

  project: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs },

  // Sections
  section: { marginTop: spacing.xl },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Chips
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 13, fontWeight: '600' },

  // Due date
  dueDateText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  dueDateEmpty: { fontSize: 15, color: colors.textSecondary, fontStyle: 'italic' },
  dueDateEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dueDateInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  dueDateSaveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  dueDateSaveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dueDateClearBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dueDateClearBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },

  // Body text
  body: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  bodyEmpty: { fontSize: 15, color: colors.textSecondary, fontStyle: 'italic' },

  // Description input
  descriptionInput: {
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    minHeight: 100,
    lineHeight: 22,
  },

  // Comments
  comment: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  commentText: { fontSize: 15, color: colors.textPrimary },
  commentDate: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.xs },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    minHeight: 40,
    maxHeight: 120,
  },
  commentSendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
  },
  commentSendBtnDisabled: {
    backgroundColor: colors.border,
  },
  commentSendBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  // Delete
  deleteBtn: {
    marginTop: spacing.xxxl,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.destructive,
    backgroundColor: colors.destructive + '10',
  },
  deleteBtnText: { color: colors.destructive, fontSize: 15, fontWeight: '600' },
})
