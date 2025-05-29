import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  Alert,
  ScrollView,
} from 'react-native';
import { Text, Divider, Button } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { useSession } from '@/utils/sessionContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface UserMenuDrawerProps {
  isVisible: boolean;
  onClose: () => void;
  currentUser?: {
    id: string;
    name?: string;
    role: string;
  } | null;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(320, SCREEN_WIDTH * 0.8);
const TAB_BAR_HEIGHT = 80; // Approximate tab bar height with safe area

export default function UserMenuDrawer({
  isVisible,
  onClose,
  currentUser,
}: UserMenuDrawerProps) {
  const { isDarkMode, colors } = useTheme();
  const { signOut } = useSession();
  const insets = useSafeAreaInsets();
  const slideAnim = React.useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible]);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              onClose();
              await signOut();
              router.replace('/');
            } catch (error) {
              console.error('Sign out error:', error);
            }
          },
        },
      ]
    );
  };

  const handleSettings = () => {
    onClose();
    router.push('/settings');
  };

  if (!isVisible) return null;

  return (
    <View style={styles.overlay}>
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: fadeAnim,
            },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* Drawer */}
      <Animated.View
        style={[
          styles.drawer,
          {
            backgroundColor: isDarkMode ? colors.card : '#fff',
            transform: [{ translateX: slideAnim }],
            paddingTop: insets.top + 20,
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView 
          style={styles.scrollContent}
          contentContainerStyle={[
            styles.scrollContentContainer,
            { 
              paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20 
            }
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* User Info */}
          <View style={styles.userSection}>
            <View style={styles.userAvatar}>
              <Ionicons name="person" size={32} color={colors.primary} />
            </View>
            <Text
              variant="titleLarge"
              style={[styles.userName, { color: colors.text }]}
            >
              {currentUser?.name || 'User'}
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.userRole, { color: colors.text, opacity: 0.7 }]}
            >
              {currentUser?.role === 'admin' ? 'Administrator' : 'User'}
            </Text>
          </View>

          <Divider style={styles.divider} />

          {/* Menu Items */}
          <View style={styles.menuSection}>
            <TouchableOpacity
              style={[
                styles.menuItem,
                { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)' },
              ]}
              onPress={handleSettings}
            >
              <View style={styles.menuItemContent}>
                <View style={styles.menuItemLeft}>
                  <Ionicons name="settings-outline" size={24} color={colors.primary} />
                  <Text
                    variant="bodyLarge"
                    style={[styles.menuItemText, { color: colors.text }]}
                  >
                    Settings
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.text} opacity={0.5} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Bottom Section */}
          <View style={styles.bottomSection}>
            <Button
              mode="contained"
              onPress={handleSignOut}
              style={[
                styles.signOutButton,
                { backgroundColor: '#F44336' },
              ]}
              contentStyle={styles.signOutButtonContent}
              labelStyle={styles.signOutButtonText}
              icon="logout"
            >
              Sign Out
            </Button>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  userSection: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
  },
  userAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  userName: {
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  userRole: {
    textAlign: 'center',
    fontSize: 14,
  },
  divider: {
    marginVertical: 10,
    marginHorizontal: 20,
  },
  menuSection: {
    paddingHorizontal: 20,
    paddingTop: 10,
    flex: 1,
  },
  menuItem: {
    borderRadius: 12,
    marginBottom: 8,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemText: {
    marginLeft: 16,
    fontWeight: '500',
  },
  bottomSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    marginTop: 'auto',
  },
  signOutButton: {
    borderRadius: 12,
  },
  signOutButtonContent: {
    paddingVertical: 8,
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
}); 