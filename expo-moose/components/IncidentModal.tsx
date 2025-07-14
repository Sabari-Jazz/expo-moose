import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import {
  Modal,
  Portal,
  Text,
  ActivityIndicator,
} from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '../utils/sessionContext';
import { Incident } from '../api/api';

const { height: screenHeight } = Dimensions.get('window');

interface IncidentModalProps {
  visible: boolean;
  onDismiss: () => void;
  incidents: Incident[];
}

export default function IncidentModal({ visible, onDismiss, incidents }: IncidentModalProps) {
  const { isDarkMode, colors } = useTheme();
  const { updateIncident } = useSession();
  const [processingIncidents, setProcessingIncidents] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);

  // Filter to only show pending incidents
  const pendingIncidents = incidents.filter(incident => incident.status === 'pending');

  const handleIncidentAction = async (incident: Incident, action: 'dismiss' | 'escalate') => {
    const incidentId = incident.PK.replace('Incident#', '');
    
    // Add to processing set
    setProcessingIncidents(prev => new Set(prev).add(incidentId));
    
    try {
      const success = await updateIncident(incidentId, action);
      
      if (!success) {
        console.error(`Failed to ${action} incident ${incidentId}`);
        // You might want to show an error message here
      }
    } catch (error) {
      console.error(`Error ${action}ing incident:`, error);
    } finally {
      // Remove from processing set
      setProcessingIncidents(prev => {
        const newSet = new Set(prev);
        newSet.delete(incidentId);
        return newSet;
      });
    }
  };

  const formatIncidentTime = (expiresAt: number): string => {
    const expirationDate = new Date(expiresAt * 1000);
    const now = new Date();
    const diffMs = expirationDate.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins <= 0) {
      return 'Expired';
    } else if (diffMins < 60) {
      return `${diffMins} min remaining until technician is notified`;
    } else {
      return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m remaining until technician is notified`;
    }
  };

  const getDeviceDisplayName = (deviceId: string): string => {
    return `Device ${deviceId.substring(0, 8)}...`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'red':
        return { name: 'alert-circle' as const, color: '#f44336' };
      case 'offline':
        return { name: 'power' as const, color: '#757575' };
      default:
        return { name: 'warning' as const, color: '#ff9800' };
    }
  };

  const nextCard = () => {
    setCurrentIndex((prev) => (prev + 1) % pendingIncidents.length);
  };

  const prevCard = () => {
    setCurrentIndex((prev) => (prev - 1 + pendingIncidents.length) % pendingIncidents.length);
  };

  const handleDismiss = () => {
    if (pendingIncidents[currentIndex]) {
      handleIncidentAction(pendingIncidents[currentIndex], 'dismiss');
    }
  };

  const handleLater = () => {
    onDismiss();
  };

  const renderDots = () => {
    if (pendingIncidents.length <= 1) return null;
    
    return (
      <View style={styles.dotsContainer}>
        {pendingIncidents.map((_, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setCurrentIndex(index)}
            style={[
              styles.dot,
              index === currentIndex ? 
                [styles.activeDot, { backgroundColor: colors.primary }] : 
                [styles.inactiveDot, { backgroundColor: isDarkMode ? '#444' : '#D1D5DB' }],
            ]}
          />
        ))}
      </View>
    );
  };

  if (pendingIncidents.length === 0) {
    return null; // Don't show modal if no pending incidents
  }

  const currentIncident = pendingIncidents[currentIndex];
  const incidentId = currentIncident.PK.replace('Incident#', '');
  const isProcessing = processingIncidents.has(incidentId);
  const icon = getStatusIcon('red'); // Assuming these are error incidents

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.overlay}
      >
        <StatusBar backgroundColor="rgba(0,0,0,0.5)" barStyle="light-content" />
        <SafeAreaView style={[
          styles.modalContainer,
          { backgroundColor: isDarkMode ? colors.card : 'white' }
        ]}>
          {/* Header */}
          <View style={[
            styles.header,
            { borderBottomColor: isDarkMode ? colors.border : '#E5E7EB' }
          ]}>
            <View style={styles.headerLeft}>
              <Ionicons name="warning" size={20} color={colors.primary} />
              <Text style={[styles.title, { color: colors.text }]}>
                System Alert
              </Text>
            </View>
            <TouchableOpacity onPress={onDismiss} style={styles.closeButton}>
              <Text style={[styles.closeButtonText, { color: isDarkMode ? '#aaa' : '#6B7280' }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Card Area */}
          <View style={styles.cardArea}>
            {/* Navigation */}
            <View style={styles.navigation}>
              <TouchableOpacity
                onPress={prevCard}
                disabled={pendingIncidents.length <= 1}
                style={[
                  styles.navButton,
                  { backgroundColor: isDarkMode ? colors.card : '#F3F4F6' },
                  pendingIncidents.length <= 1 && styles.disabledButton,
                ]}
              >
                <Text style={[styles.navButtonText, { color: colors.text }]}>‹</Text>
              </TouchableOpacity>

              <Text style={[styles.counter, { color: isDarkMode ? '#aaa' : '#6B7280' }]}>
                {currentIndex + 1} of {pendingIncidents.length}
              </Text>

              <TouchableOpacity
                onPress={nextCard}
                disabled={pendingIncidents.length <= 1}
                style={[
                  styles.navButton,
                  { backgroundColor: isDarkMode ? colors.card : '#F3F4F6' },
                  pendingIncidents.length <= 1 && styles.disabledButton,
                ]}
              >
                <Text style={[styles.navButtonText, { color: colors.text }]}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Current Card */}
            <View style={[
              styles.card,
              { 
                backgroundColor: isDarkMode ? colors.background : '#EBF5FF',
                borderColor: isDarkMode ? colors.border : '#BFDBFE'
              }
            ]}>
              {/* Alert Icon */}
              <View style={styles.alertIconContainer}>
                <Ionicons name={icon.name} size={48} color={icon.color} />
              </View>

              {/* Device Info */}
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {getDeviceDisplayName(currentIncident.device_name)}
              </Text>
              
              <Text style={[styles.cardContent, { color: isDarkMode ? '#aaa' : '#4B5563' }]}>
                System: {currentIncident.system_name}...
              </Text>
              
              <Text style={[styles.cardSubtitle, { color: isDarkMode ? '#888' : '#6B7280' }]}>
                ⏰ {formatIncidentTime(currentIncident.expiresAt)}
              </Text>

              {/* Description */}
              <View style={styles.descriptionContainer}>
                <Text style={[styles.descriptionTitle, { color: colors.text }]}>
                  What happened?
                </Text>
                <Text style={[styles.description, { color: isDarkMode ? '#aaa' : '#4B5563' }]}>
                  Device status change detected. This system requires your attention.
                </Text>
              </View>

              {/* Action Question */}
              <Text style={[styles.questionText, { color: colors.text }]}>
                How would you like to handle this alert?
              </Text>
            </View>

            {/* Dots Indicator */}
            {renderDots()}
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              onPress={handleDismiss} 
              disabled={isProcessing}
              style={[
                styles.dismissButton,
                { backgroundColor: isDarkMode ? colors.card : '#F3F4F6' }
              ]}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={[styles.dismissButtonText, { color: colors.text }]}>
                  Dismiss
                </Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={handleLater} 
              style={[
                styles.laterButton,
                { backgroundColor: colors.primary }
              ]}
            >
              <Text style={styles.laterButtonText}>Handle Later</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    borderRadius: 16,
    width: '100%',
    height: screenHeight * 0.8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginLeft: 8,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cardArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  navButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  counter: {
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    borderRadius: 12,
    padding: 24,
    minHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  alertIconContainer: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  cardContent: {
    fontSize: 16,
    marginBottom: 4,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  descriptionContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  descriptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  questionText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  activeDot: {
    // backgroundColor set dynamically
  },
  inactiveDot: {
    // backgroundColor set dynamically
  },
  buttonContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  dismissButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  dismissButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  laterButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  laterButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
}); 