import type { ReactNode } from "react";
import { View } from "react-native";
import { Card, Text } from "react-native-paper";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Carte de section réutilisable combinant NativeWind (mise en page via className
 * sur les composants React Native de base) et React Native Paper (Material Design 3
 * + thème Somafrik).
 */
export function SectionCard({ title, subtitle, children, footer }: SectionCardProps) {
  return (
    <Card mode="elevated" style={{ margin: 12, borderRadius: 16, overflow: "hidden" }}>
      <View className="gap-1 p-4">
        <Text variant="titleMedium">{title}</Text>
        {subtitle ? <Text variant="bodySmall">{subtitle}</Text> : null}
      </View>

      {children ? <View className="px-4 pb-2">{children}</View> : null}

      {footer ? <Card.Actions>{footer}</Card.Actions> : null}
    </Card>
  );
}
