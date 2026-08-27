import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation, CommonActions } from '@react-navigation/native'
import { useUser } from '@clerk/expo'
import { DollarSign, Clock } from 'lucide-react-native'
import { useProjectDetail } from '../../hooks/useProjects'
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed'
import { colors } from '../../theme/colors'
import { spacing } from '../../theme/spacing'
import { getStatusLabel, getStatusColor, getPriorityColor } from '../../utils/status'
import { formatDate } from '../../utils/dates'
import type { ProjectsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectDetail'>
type Tab = 'overview' | 'tasks' | 'time' | 'budget'

export function ProjectDetailScreen({ route }: Props) {
  const { id } = route.params
  const navigation = useNavigation()
  const { user } = useUser()
  const { data: project, isLoading, isRefetching, refetch } = useProjectDetail(id)
  const { addItem } = useRecentlyViewed(user?.id)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  useEffect(() => {
    if (project) {
      addItem({ id: project.id, type: 'project', name: project.name, subtitle: project.client.name })
    }
  }, [project?.id])

  useEffect(() => {
    if (!project && !isLoading) {
      navigation.goBack()
    }
  }, [project, isLoading, navigation])

  if (isLoading && !project) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!project && !isLoading) {
    return null
  }

  const totalTasks = project?.tasks?.length ?? 0
  const completedTasks = project?.tasks?.filter(t => t.status === 'done').length ?? 0
  const totalHours = project?.timeEntries?.reduce((sum, e) => sum + e.hours, 0) ?? 0

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: `Tasks (${totalTasks})` },
    { key: 'time', label: 'Time' },
    { key: 'budget', label: 'Budget' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {project && (
        <>
          <View style={styles.header}>
            <Text style={styles.name}>{project.name}</Text>
            <Text style={styles.client}>{project.client.name}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(project.status) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(project.status) }]}>
                  {getStatusLabel(project.status)}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: getPriorityColor(project.priority) + '20' }]}>
                <Text style={[styles.statusText, { color: getPriorityColor(project.priority) }]}>
                  {project.priority}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.tabBar}>
            {tabs.map(tab => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          >
            {activeTab === 'overview' && (
              <>
                {project.dueDate && (
                  <Text style={styles.due}>Due: {formatDate(project.dueDate)}</Text>
                )}

                {project.description && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Description</Text>
                    <Text style={styles.description}>{project.description}</Text>
                  </View>
                )}

                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{completedTasks}/{totalTasks}</Text>
                    <Text style={styles.statLabel}>Tasks Done</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{totalHours.toFixed(1)}h</Text>
                    <Text style={styles.statLabel}>Tracked</Text>
                  </View>
                  {project.budget && (
                    <View style={styles.statBox}>
                      <Text style={styles.statValue}>${project.budget.toLocaleString()}</Text>
                      <Text style={styles.statLabel}>Budget</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {activeTab === 'tasks' && (
              <View style={styles.section}>
                {project.tasks && project.tasks.length > 0 ? (
                  project.tasks.map(task => (
                    <TouchableOpacity
                      key={task.id}
                      style={styles.taskRow}
                      onPress={() => navigation.dispatch(CommonActions.navigate({ name: 'TasksTab', params: { screen: 'TaskDetail', params: { id: task.id } } }))}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.taskDot, { backgroundColor: getStatusColor(task.status) }]} />
                      <View style={styles.taskContent}>
                        <Text style={[styles.taskTitle, task.status === 'done' && styles.taskDone]} numberOfLines={1}>
                          {task.title}
                        </Text>
                        {task.dueDate && (
                          <Text style={styles.taskDue}>{formatDate(task.dueDate)}</Text>
                        )}
                      </View>
                      <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(task.priority) }]} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.emptyTab}>No tasks for this project yet.</Text>
                )}
              </View>
            )}

            {activeTab === 'time' && (
              <View style={styles.section}>
                {project.timeEntries && project.timeEntries.length > 0 ? (
                  <>
                    <View style={styles.timeSummary}>
                      <Clock size={20} color={colors.primary} />
                      <Text style={styles.timeTotalLabel}>Total:</Text>
                      <Text style={styles.timeTotalValue}>{totalHours.toFixed(1)} hours</Text>
                      {project.hourlyRate && (
                        <Text style={styles.timeEarned}>
                          (${(totalHours * project.hourlyRate).toFixed(2)})
                        </Text>
                      )}
                    </View>
                    {project.timeEntries.map(entry => (
                      <View key={entry.id} style={styles.timeRow}>
                        <View style={styles.timeInfo}>
                          <Text style={styles.timeHours}>{entry.hours}h</Text>
                          {entry.description && (
                            <Text style={styles.timeDesc} numberOfLines={1}>{entry.description}</Text>
                          )}
                        </View>
                        <Text style={styles.timeDate}>{formatDate(entry.date)}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text style={styles.emptyTab}>No time entries yet.</Text>
                )}
              </View>
            )}

            {activeTab === 'budget' && (
              <View style={styles.section}>
                <View style={styles.budgetCard}>
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Budget</Text>
                    <Text style={styles.budgetValue}>
                      {project.budget ? `$${project.budget.toLocaleString()}` : 'Not set'}
                    </Text>
                  </View>
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Hourly Rate</Text>
                    <Text style={styles.budgetValue}>
                      {project.hourlyRate ? `$${project.hourlyRate}/hr` : 'Not set'}
                    </Text>
                  </View>
                  {project.hourlyRate && totalHours > 0 && (
                    <>
                      <View style={styles.budgetDivider} />
                      <View style={styles.budgetRow}>
                        <Text style={styles.budgetLabel}>Time Billed</Text>
                        <Text style={styles.budgetValue}>{totalHours.toFixed(1)} hours</Text>
                      </View>
                      <View style={styles.budgetRow}>
                        <Text style={styles.budgetLabel}>Earned</Text>
                        <Text style={[styles.budgetValue, styles.budgetEarned]}>
                          ${(totalHours * project.hourlyRate).toFixed(2)}
                        </Text>
                      </View>
                      {project.budget && (
                        <View style={styles.budgetRow}>
                          <Text style={styles.budgetLabel}>Remaining</Text>
                          <Text style={[styles.budgetValue, {
                            color: project.budget - (totalHours * project.hourlyRate) > 0 ? colors.success : colors.destructive,
                          }]}>
                            ${(project.budget - (totalHours * project.hourlyRate)).toFixed(2)}
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: 0 },
  content: { padding: spacing.lg },
  name: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  client: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 8 },
  statusText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  due: { fontSize: 15, color: colors.textSecondary },
  tabBar: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border, paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
  tab: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginRight: spacing.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '600' },
  section: { marginTop: spacing.sm },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  description: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  statBox: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  taskDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.md },
  taskContent: { flex: 1 },
  taskTitle: { fontSize: 15, color: colors.textPrimary },
  taskDone: { textDecorationLine: 'line-through', color: colors.textSecondary },
  taskDue: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  timeSummary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primary + '10', borderRadius: 10, padding: spacing.lg, marginBottom: spacing.lg,
  },
  timeTotalLabel: { fontSize: 15, color: colors.textSecondary },
  timeTotalValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  timeEarned: { fontSize: 13, color: colors.success },
  timeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  timeInfo: { flex: 1 },
  timeHours: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  timeDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  timeDate: { fontSize: 13, color: colors.textSecondary },
  budgetCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  budgetLabel: { fontSize: 15, color: colors.textSecondary },
  budgetValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  budgetEarned: { color: colors.primary },
  budgetDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  emptyTab: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl, fontSize: 15 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, fontSize: 15 },
})
