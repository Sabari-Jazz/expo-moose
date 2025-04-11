import React, { useState, useEffect } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { DataTable, Text, Button, Card, Divider } from "react-native-paper";
import { getCurrentUser, getAccessibleSystems, User } from "@/utils/auth";
import { useTheme } from "@/hooks/useTheme";

interface UserSystemAccessTableProps {
  userId?: string;
  showAllSystems?: boolean;
}

const UserSystemAccessTable = ({
  userId,
  showAllSystems = false,
}: UserSystemAccessTableProps) => {
  const { colors, isDarkMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Omit<User, "password"> | null>(null);
  const [accessibleSystems, setAccessibleSystems] = useState<string[]>([]);
  const [allSystems, setAllSystems] = useState<any[]>([]);

  const systems = [
    {
      id: "bf915090-5f59-4128-a206-46c73f2f779d",
      name: "Solar System 1",
      location: "Berlin",
    },
    {
      id: "f2fafda2-9b07-40e3-875f-db6409040b9c",
      name: "Solar System 2",
      location: "Munich",
    },
    {
      id: "38e65323-1b9c-4a0f-8f4e-73d42e21c5c4",
      name: "Solar System 3",
      location: "Frankfurt",
    },
    {
      id: "7fd989a3-1d23-4b8c-9efa-c34c03e3829d",
      name: "Solar System 4",
      location: "Hamburg",
    },
  ];

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        setLoading(true);

        const currentUser = userId ? null : await getCurrentUser();
        const userToUse = userId || currentUser?.id;

        if (userToUse) {
          if (currentUser) {
            setUser(currentUser);
          }

          const accessibleSystemIds = getAccessibleSystems(userToUse);

          const isAdmin =
            currentUser?.role === "admin" || accessibleSystemIds.length === 0;

          if (isAdmin || showAllSystems) {
            setAllSystems(systems);
            setAccessibleSystems([]);
          } else {
            const filteredSystems = systems.filter((s) =>
              accessibleSystemIds.includes(s.id)
            );
            setAllSystems(systems);
            setAccessibleSystems(accessibleSystemIds);
          }
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [userId, showAllSystems]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text>Loading user system access...</Text>
      </View>
    );
  }

  if (!user && !userId) {
    return (
      <View style={styles.centered}>
        <Text>You must be logged in to view this information.</Text>
      </View>
    );
  }

  const isAdmin = user?.role === "admin";

  return (
    <Card style={[styles.container, { backgroundColor: colors.card }]}>
      <Card.Title
        title="System Access Information"
        subtitle={
          isAdmin
            ? "Administrator Access (All Systems)"
            : "User-Specific Access"
        }
      />

      <Card.Content>
        {isAdmin && (
          <Text style={styles.adminText}>
            As an administrator, you have access to all systems in the network.
          </Text>
        )}

        {!isAdmin && (
          <Text style={styles.userText}>
            You have access to {accessibleSystems.length} specific systems.
          </Text>
        )}

        <Divider style={styles.divider} />

        <ScrollView horizontal>
          <DataTable>
            <DataTable.Header>
              <DataTable.Title style={styles.idColumn}>
                System ID
              </DataTable.Title>
              <DataTable.Title style={styles.nameColumn}>Name</DataTable.Title>
              <DataTable.Title style={styles.locationColumn}>
                Location
              </DataTable.Title>
              <DataTable.Title style={styles.accessColumn}>
                Access
              </DataTable.Title>
            </DataTable.Header>

            {allSystems.map((system) => {
              const hasAccess =
                isAdmin || accessibleSystems.includes(system.id);

              return (
                <DataTable.Row key={system.id}>
                  <DataTable.Cell style={styles.idColumn}>
                    {system.id.substring(0, 8)}...
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.nameColumn}>
                    {system.name}
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.locationColumn}>
                    {system.location}
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.accessColumn}>
                    <View style={styles.accessIndicator}>
                      <View
                        style={[
                          styles.accessDot,
                          {
                            backgroundColor: hasAccess ? "#4CAF50" : "#F44336",
                          },
                        ]}
                      />
                      <Text>{hasAccess ? "Yes" : "No"}</Text>
                    </View>
                  </DataTable.Cell>
                </DataTable.Row>
              );
            })}
          </DataTable>
        </ScrollView>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 10,
    elevation: 4,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  adminText: {
    fontWeight: "bold",
    marginBottom: 10,
  },
  userText: {
    marginBottom: 10,
  },
  divider: {
    marginVertical: 10,
  },
  idColumn: {
    flex: 3,
  },
  nameColumn: {
    flex: 2,
  },
  locationColumn: {
    flex: 2,
  },
  accessColumn: {
    flex: 1,
    justifyContent: "center",
  },
  accessIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  accessDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 5,
  },
});

export default UserSystemAccessTable;
