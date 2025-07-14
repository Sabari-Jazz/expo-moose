import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  Card,
  Chip,
  Divider,
} from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/utils/sessionContext';
import { Incident } from '../api/api';

interface IncidentsListProps {
  incidents: Incident[];
}

export default function IncidentsList({ incidents }: IncidentsListProps) {
  const { isDarkMode, colors } = useTheme();

  const formatIncidentTime = (expiresAt: number): string => {
    const expirationDate = new Date(expiresAt * 1000);
    const now = new Date();
    const diffMs = expirationDate.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins <= 0) {
      return 'Expired';
    } else if (diffMins < 60) {
      return `${diffMins} min remaining`;
    } else {
      return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m remaining`;
    }
  };

  const getDeviceDisplayName = (deviceId: string): string => {
    return `Device ${deviceId.substring(0, 8)}...`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return '#ff9800';
      case 'escalated':
        return '#f44336';
      case 'dismissed':
        return '#4caf50';
      default:
        return '#757575';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return 'time-outline';
      case 'escalated':
        return 'arrow-up-circle';
      case 'dismissed':
        return 'checkmark-circle';
      default:
        return 'help-circle';
    }
  };

  const renderIncident = (incident: Incident) => {
    return (
      <Card key={incident.PK} style={[styles.incidentCard, { backgroundColor: isDarkMode ? colors.card : '#fafafa' }]}>
        <Card.Content>
          <View style={styles.incidentHeader}>
            <View style={styles.incidentInfo}>
              <Text variant="titleMedium" style={[styles.incidentTitle, { color: colors.text }]}>
                {getDeviceDisplayName(incident.deviceId)}
              </Text>
              <Text variant="bodySmall" style={[styles.incidentSystem, { color: isDarkMode ? '#aaa' : '#666' }]}>
                System: {incident.systemId.substring(0, 8)}...
              </Text>
              <Text variant="bodySmall" style={[styles.incidentTime, { color: isDarkMode ? '#aaa' : '#666' }]}>
                {incident.status === 'pending' ? formatIncidentTime(incident.expiresAt) : 
                 incident.updatedAt ? `Updated ${new Date(incident.updatedAt).toLocaleString()}` :
                 `Created ${new Date(incident.expiresAt * 1000 - 3600000).toLocaleString()}`}
              </Text>
            </View>
            <View style={styles.statusContainer}>
              <Chip 
                mode="outlined" 
                compact 
                style={[styles.statusChip, { borderColor: getStatusColor(incident.status) }]}
                textStyle={{ color: getStatusColor(incident.status) }}
                icon={getStatusIcon(incident.status)}
              >
                {incident.status.charAt(0).toUpperCase() + incident.status.slice(1)}
              </Chip>
            </View>
          </View>
          
          <Text variant="bodyMedium" style={[styles.incidentDescription, { color: colors.text }]}>
            Device status change detected
          </Text>
        </Card.Content>
      </Card>
    );
  };

  if (incidents.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="shield-checkmark" size={48} color={colors.primary} />
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: colors.text }]}>
          No Incidents
        </Text>
        <Text variant="bodyMedium" style={[styles.emptySubtitle, { color: isDarkMode ? '#aaa' : '#666' }]}>
          All your systems are running smoothly
        </Text>
      </View>
    );
  }

  // Group incidents by status
  const groupedIncidents = incidents.reduce((groups, incident) => {
    const status = incident.status;
    if (!groups[status]) {
      groups[status] = [];
    }
    groups[status].push(incident);
    return groups;
  }, {} as Record<string, Incident[]>);

  const statusOrder = ['pending', 'escalated', 'dismissed'];
  const sortedStatuses = statusOrder.filter(status => groupedIncidents[status]?.length > 0);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {sortedStatuses.map((status) => (
        <View key={status} style={styles.statusGroup}>
          <View style={styles.statusHeader}>
            <Ionicons 
              name={getStatusIcon(status) as any} 
              size={20} 
              color={getStatusColor(status)} 
            />
            <Text variant="titleMedium" style={[styles.statusTitle, { color: colors.text }]}>
              {status.charAt(0).toUpperCase() + status.slice(1)} ({groupedIncidents[status].length})
            </Text>
          </View>

          {groupedIncidents[status].map((incident, index) => 
            renderIncident(incident)
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    marginTop: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    marginTop: 8,
    textAlign: 'center',
  },
  statusGroup: {
    marginBottom: 8,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusTitle: {
    marginLeft: 8,
    fontWeight: '600',
  },
  incidentCard: {
    marginHorizontal: 16,
    elevation: 1,
  },
  cardContent: {
    padding: 12,
  },
  incidentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  incidentInfo: {
    flex: 1,
    marginRight: 12,
  },
  incidentTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  incidentSystem: {
    marginBottom: 2,
  },
  incidentTime: {
    fontStyle: 'italic',
  },
  statusChip: {
    height: 28,
  },
  statusContainer: {
    marginLeft: 8,
  },
  incidentDescription: {
    marginTop: 8,
  },
  incidentSeverity: {
    marginTop: 4,
  },
}); 