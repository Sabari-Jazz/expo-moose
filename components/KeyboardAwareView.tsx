import React, { ReactNode, useEffect, useRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
  StyleProp,
  Keyboard,
  TouchableWithoutFeedback,
  Dimensions,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Animated,
} from "react-native";

interface KeyboardAwareViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  dismissKeyboardOnTouch?: boolean;
  bottomTabBarHeight?: number;
  extraScrollHeight?: number;
}

/**
 * A component that handles keyboard appearance for forms and text inputs,
 * ensuring they're not covered by the bottom tab bar.
 */
export const KeyboardAwareView: React.FC<KeyboardAwareViewProps> = ({
  children,
  style,
  contentContainerStyle,
  dismissKeyboardOnTouch = true,
  bottomTabBarHeight = 80,
  extraScrollHeight = 50,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const screenHeight = Dimensions.get("window").height;

  // Adjust padding based on platform and screen size
  const bottomPadding =
    Platform.OS === "android"
      ? bottomTabBarHeight + extraScrollHeight
      : bottomTabBarHeight;

  // Function to handle keyboard showing
  const handleKeyboardShow = (event: KeyboardEvent) => {
    if (Platform.OS === "android" && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  // Set up keyboard listeners
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      "keyboardDidShow",
      handleKeyboardShow
    );

    return () => {
      keyboardDidShowListener.remove();
    };
  }, []);

  // Function to handle scroll events
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
  };

  const content = (
    <ScrollView
      ref={scrollViewRef}
      style={[styles.scrollView, style]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: bottomPadding },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    >
      {children}
    </ScrollView>
  );

  if (dismissKeyboardOnTouch) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={
          Platform.OS === "ios" ? bottomTabBarHeight + 30 : 0
        }
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          {content}
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={
        Platform.OS === "ios" ? bottomTabBarHeight + 30 : 0
      }
    >
      {content}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
});

export default KeyboardAwareView;
