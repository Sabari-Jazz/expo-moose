import React, { useState, useEffect } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { DataTable, Text, Button, Card, Divider } from "react-native-paper";
import { getCurrentUser, getAccessibleSystems, User } from "@/utils/cognitoAuth";
import { useTheme } from "@/hooks/useTheme";
import { PvSystemMetadata } from "@/api/api";

interface UserSystemAccessTableProps {
  userId?: string;
  showAllSystems?: boolean;
  systems?: PvSystemMetadata[];
  accessibleSystemIds?: string[];
  isAdmin?: boolean;
}

const UserSystemAccessTable = ({
  userId,
  showAllSystems = false,
  systems: propsSystems,
  accessibleSystemIds: propsAccessibleSystemIds,
  isAdmin: propsIsAdmin,
}: UserSystemAccessTableProps) => {
  const { colors, isDarkMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Omit<User, "password"> | null>(null);
  const [accessibleSystems, setAccessibleSystems] = useState<string[]>([]);
  const [allSystems, setAllSystems] = useState<PvSystemMetadata[]>([]);
  const [userIsAdmin, setUserIsAdmin] = useState(false);

  const mockSystems = [
    {
      pvSystemId: "bf915090-5f59-4128-a206-46c73f2f779d",
      name: "Solar System 1",
      address: { city: "Berlin", country: "Germany" },
    },
    {
      pvSystemId: "f2fafda2-9b07-40e3-875f-db6409040b9c",
      name: "Solar System 2",
      address: { city: "Munich", country: "Germany" },
    },
    {
      pvSystemId: "38e65323-1b9c-4a0f-8f4e-73d42e21c5c4",
      name: "Solar System 3",
      address: { city: "Frankfurt", country: "Germany" },
    },
    {
      pvSystemId: "7fd989a3-1d23-4b8c-9efa-c34c03e3829d",
      name: "Solar System 4",
      address: { city: "Hamburg", country: "Germany" },
    },
  ];

  const formatAddress = (address: any) => {
    if (!address) return "Unknown";

    const parts = [address.city, address.state, address.country].filter(
      Boolean
    );

    return parts.join(", ");
  };

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        setLoading(true);
        
        // Mock systems data with complete PvSystemMetadata structure
        const mockSystems: PvSystemMetadata[] = [
          {
            pvSystemId: "system1",
            name: "Residential Solar Array 1",
            address: {
              city: "San Francisco",
              country: "USA",
              street: null,
              state: null,
              zipCode: null,
            },
            pictureURL: null,
            peakPower: 5000,
            installationDate: "2023-01-01T00:00:00Z",
            lastImport: "2023-12-01T00:00:00Z",
            meteoData: null,
            timeZone: "America/Los_Angeles"
          },
          {
            pvSystemId: "system2", 
            name: "Commercial Solar Array 2",
            address: {
              city: "Los Angeles",
              country: "USA",
              street: null,
              state: null,
              zipCode: null,
            },
            pictureURL: null,
            peakPower: 10000,
            installationDate: "2023-02-01T00:00:00Z",
            lastImport: "2023-12-01T00:00:00Z",
            meteoData: null,
            timeZone: "America/Los_Angeles"
          },
          {
            pvSystemId: "system3",
            name: "Industrial Solar Array 3", 
            address: {
              city: "San Diego",
              country: "USA",
              street: null,
              state: null,
              zipCode: null,
            },
            pictureURL: null,
            peakPower: 15000,
            installationDate: "2023-03-01T00:00:00Z",
            lastImport: "2023-12-01T00:00:00Z",
            meteoData: null,
            timeZone: "America/Los_Angeles"
          },
        ];

        const currentUser = await getCurrentUser();
        const userToUse = userId || currentUser?.id || "default";
        
        if (currentUser) {
          const accessibleSystemIds = await getAccessibleSystems(userToUse);
          const isAdmin =
            currentUser?.role === "admin" || accessibleSystemIds.length === 0;
          setUserIsAdmin(isAdmin);

          if (isAdmin || showAllSystems) {
            setAllSystems(mockSystems);
            setAccessibleSystems([]);
          } else {
            const filteredSystems = mockSystems.filter((s) =>
              accessibleSystemIds.includes(s.pvSystemId)
            );
            setAllSystems(mockSystems);
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
  }, [
    userId,
    showAllSystems,
    propsSystems,
    propsAccessibleSystemIds,
    propsIsAdmin,
  ]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text>Loading user system access...</Text>
      </View>
    );
  }

  if (!user && !userId && !propsSystems) {
    return (
      <View style={styles.centered}>
        <Text>You must be logged in to view this information.</Text>
      </View>
    );
  }

  return (
    <Card style={[styles.container, { backgroundColor: colors.card }]}>
      <Card.Title
        title="System Access Information"
        subtitle={
          userIsAdmin
            ? "Administrator Access (All Systems)"
            : "User-Specific Access"
        }
      />

      <Card.Content>
        {userIsAdmin && (
          <Text style={styles.adminText}>
            As an administrator, you have access to all systems in the network.
          </Text>
        )}

        {!userIsAdmin && (
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
                userIsAdmin || accessibleSystems.includes(system.pvSystemId);

              return (
                <DataTable.Row key={system.pvSystemId}>
                  <DataTable.Cell style={styles.idColumn}>
                    {system.pvSystemId.substring(0, 8)}...
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.nameColumn}>
                    {system.name}
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.locationColumn}>
                    {formatAddress(system.address)}
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
