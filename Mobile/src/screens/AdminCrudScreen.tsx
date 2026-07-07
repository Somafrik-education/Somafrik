import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { AdminEntity, useAdminData } from "../context/AdminDataContext";
import { messageThemes, rolePermissions, DEFAULT_CLASS_NAMES, DEFAULT_LEVELS, DEFAULT_SUBJECTS, DEFAULT_TRACKS, UserAccount } from "../data/catalog";
import { useAuth } from "../context/AuthContext";
import { canMutateEntity, canReadEntity, hasSecurityPermission, isSuperAdminRole, SecurityAction } from "../domain/security/permissions";
import { resetUserPassword as resetUserPasswordOnBackend } from "../services/api";
import { removeSchoolClassFromState } from "../lib/classRules";
import { formatTeacherClasses } from "../lib/teacherClasses";
import { validateCourseTeacherRule } from "../lib/pedagogyGovernance";
import { PENDING_VALIDATION_STATUS } from "../lib/orgHierarchy";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { isTeacherUserRole, upsertTeacherFromUser } from "../lib/userTeacherSync";

type Props = NativeStackScreenProps<RootStackParamList, "AdminCrud">;

type Field = {
  key: string;
  label: string;
  placeholder: string;
  keyboardType?: "default" | "numeric";
  type?: "text" | "select" | "date" | "photo";
};

const teacherCourseAssignmentType = "Professeur → cours";
const studentClassAssignmentType = "Élève → classe";
const rolePilotageActions: Array<{ key: SecurityAction; label: string }> = [
  { key: "READ", label: "Lire" },
  { key: "CREATE", label: "Créer" },
  { key: "UPDATE", label: "Modifier" },
  { key: "DELETE", label: "Supprimer" },
  { key: "SUSPEND", label: "Suspendre" },
];
const schoolPilotageFeatures = [
  "Utilisateurs",
  "Classes",
  "Élèves",
  "Enseignants",
  "Affectations",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Notifications",
  "Messages",
  "Documents",
  "Rapports",
  "Années Académiques",
  "Matières",
  "Examens",
  "Paramètres Établissement",
];

const configs: Record<
  AdminEntity,
  {
    title: string;
    addLabel: string;
    fields: Field[];
  }
> = {
  students: {
    title: "Gestion des élèves",
    addLabel: "Ajouter un élève",
    fields: [
      { key: "name", label: "Nom", placeholder: "Nom complet" },
      { key: "firstName", label: "Prénom", placeholder: "Prénom" },
      { key: "gender", label: "Sexe", placeholder: "Choisir le sexe", type: "select" },
      { key: "birthDate", label: "Date de naissance", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "className", label: "Classe", placeholder: "Choisir une classe", type: "select" },
      { key: "parentName", label: "Nom du parent", placeholder: "Nom complet du parent" },
      { key: "parentPhone", label: "Téléphone parent", placeholder: "+243 ..." },
      { key: "parentEmail", label: "Email parent", placeholder: "parent@email.com" },
    ],
  },
  teachers: {
    title: "Gestion des enseignants",
    addLabel: "Ajouter un enseignant",
    fields: [
      { key: "name", label: "Nom", placeholder: "Nom complet" },
      { key: "firstName", label: "Prénom", placeholder: "Prénom" },
      { key: "gender", label: "Sexe", placeholder: "Choisir le sexe", type: "select" },
      { key: "phone", label: "Téléphone", placeholder: "+243 ..." },
      { key: "email", label: "Email", placeholder: "enseignant@email.com" },
      { key: "mainSubject", label: "Matière principale", placeholder: "Choisir une matière", type: "select" },
    ],
  },
  classes: {
    title: "Gestion des classes",
    addLabel: "Ajouter une classe",
    fields: [
      { key: "name", label: "Nom de classe", placeholder: "Choisir une classe", type: "select" },
      { key: "level", label: "Niveau", placeholder: "Choisir un niveau", type: "select" },
      { key: "track", label: "Filière", placeholder: "Choisir une filière", type: "select" },
      { key: "teacherId", label: "Responsable", placeholder: "Choisir un enseignant", type: "select" },
    ],
  },
  countries: {
    title: "Gestion des pays",
    addLabel: "Ajouter un pays",
    fields: [
      { key: "name", label: "Pays", placeholder: "République Démocratique du Congo" },
      { key: "code", label: "Code ISO", placeholder: "CD" },
      { key: "phonePrefix", label: "Indicatif", placeholder: "+243" },
      { key: "currency", label: "Devise", placeholder: "CDF" },
      { key: "timezone", label: "Fuseau horaire", placeholder: "Africa/Kinshasa" },
      { key: "status", label: "Statut", placeholder: "Choisir le statut", type: "select" },
      { key: "administratorId", label: "Admin pays", placeholder: "Choisir un utilisateur", type: "select" },
    ],
  },
  courses: {
    title: "Gestion des cours",
    addLabel: "Ajouter un cours",
    fields: [
      { key: "className", label: "Classe", placeholder: "Choisir une classe", type: "select" },
      { key: "name", label: "Nom du cours", placeholder: "Choisir une matière", type: "select" },
      { key: "teacherId", label: "Enseignant", placeholder: "Choisir un enseignant", type: "select" },
      { key: "coefficient", label: "Coefficient", placeholder: "2", keyboardType: "numeric" },
    ],
  },
  assignments: {
    title: "Gestion des affectations",
    addLabel: "Nouvelle affectation",
    fields: [
      { key: "assignmentType", label: "Type d'affectation", placeholder: "Choisir le type", type: "select" },
      { key: "teacherId", label: "Enseignant", placeholder: "Choisir un enseignant", type: "select" },
      { key: "studentId", label: "Élève", placeholder: "Choisir un élève", type: "select" },
      { key: "className", label: "Classe", placeholder: "Choisir une classe", type: "select" },
      { key: "course", label: "Cours", placeholder: "Choisir un cours", type: "select" },
    ],
  },
  payments: {
    title: "Gestion des paiements",
    addLabel: "Ajouter un paiement",
    fields: [
      { key: "studentId", label: "ID élève", placeholder: "1" },
      { key: "amount", label: "Montant", placeholder: "25000", keyboardType: "numeric" },
      { key: "date", label: "Date", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "status", label: "Statut", placeholder: "Choisir un statut", type: "select" },
      { key: "method", label: "Mode de paiement", placeholder: "Choisir un mode", type: "select" },
    ],
  },
  subscriptions: {
    title: "Gestion des abonnements",
    addLabel: "Ajouter un abonnement",
    fields: [
      { key: "schoolCode", label: "Établissement", placeholder: "Choisir l'établissement", type: "select" },
      { key: "countryCode", label: "Code pays", placeholder: "CD" },
      { key: "country", label: "Pays", placeholder: "RDC" },
      { key: "plan", label: "Offre", placeholder: "Choisir le plan", type: "select" },
      { key: "monthlyPrice", label: "Mensuel", placeholder: "120", keyboardType: "numeric" },
      { key: "annualPrice", label: "Annuel", placeholder: "1200", keyboardType: "numeric" },
      { key: "currency", label: "Devise", placeholder: "USD" },
      { key: "status", label: "Statut", placeholder: "Choisir le statut", type: "select" },
      { key: "paymentStatus", label: "Paiement", placeholder: "Choisir le statut", type: "select" },
      { key: "startDate", label: "Début", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "endDate", label: "Fin", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "lastPaymentDate", label: "Dernier paiement", placeholder: "JJ-MM-AAAA", type: "date" },
    ],
  },
  paymentStatuses: {
    title: "Statuts de paiement",
    addLabel: "Ajouter un statut",
    fields: [
      { key: "label", label: "Libellé", placeholder: "Payé" },
      { key: "value", label: "Code", placeholder: "PAYE" },
    ],
  },
  schools: {
    title: "Gestion des établissements",
    addLabel: "Ajouter un établissement",
    fields: [
      { key: "name", label: "Nom", placeholder: "Nom de l'établissement" },
      { key: "code", label: "Code unique", placeholder: "Auto : CD-2026-0001" },
      { key: "type", label: "Type", placeholder: "Choisir le type", type: "select" },
      { key: "country", label: "Pays", placeholder: "RDC" },
      { key: "city", label: "Ville", placeholder: "Kinshasa" },
      { key: "address", label: "Adresse", placeholder: "Adresse complète" },
      { key: "phone", label: "Téléphone", placeholder: "+243 ..." },
      { key: "email", label: "Email", placeholder: "contact@ecole.cd" },
      { key: "website", label: "Site web", placeholder: "https://..." },
      { key: "slogan", label: "Slogan", placeholder: "Excellence et Innovation" },
      { key: "logoUrl", label: "Logo", placeholder: "URL JPG, PNG ou WebP" },
      { key: "status", label: "Statut", placeholder: "Choisir le statut", type: "select" },
      { key: "schoolYear", label: "Année scolaire", placeholder: "2025-2026" },
      { key: "currency", label: "Devise", placeholder: "Choisir la devise", type: "select" },
      { key: "timezone", label: "Fuseau horaire", placeholder: "Choisir le fuseau", type: "select" },
      { key: "language", label: "Langue", placeholder: "Choisir la langue", type: "select" },
      { key: "dateFormat", label: "Format date", placeholder: "Choisir le format", type: "select" },
      { key: "primaryColor", label: "Couleur principale", placeholder: "#2563EB" },
      { key: "subscriptionPlan", label: "Abonnement", placeholder: "Choisir le plan", type: "select" },
      { key: "subscriptionStartDate", label: "Début abonnement", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "subscriptionEndDate", label: "Fin abonnement", placeholder: "JJ-MM-AAAA", type: "date" },
      { key: "maxStudents", label: "Maximum élèves", placeholder: "1200", keyboardType: "numeric" },
      { key: "maxTeachers", label: "Maximum enseignants", placeholder: "120", keyboardType: "numeric" },
    ],
  },
  users: {
    title: "Gestion des utilisateurs",
    addLabel: "Créer un utilisateur",
    fields: [
      { key: "lastName", label: "Nom", placeholder: "Nom" },
      { key: "firstName", label: "Prénom", placeholder: "Prénom" },
      { key: "gender", label: "Sexe", placeholder: "Choisir le sexe", type: "select" },
      { key: "phone", label: "Téléphone", placeholder: "+243 ..." },
      { key: "role", label: "Rôle", placeholder: "Choisir le rôle", type: "select" },
      { key: "schoolCode", label: "Établissement", placeholder: "Choisir l'établissement", type: "select" },
      { key: "accessChannel", label: "Canal d'accès", placeholder: "Plateforme ou Application", type: "select" },
      { key: "identifier", label: "Identifiant unique", placeholder: "Généré par le système" },
      { key: "status", label: "Statut", placeholder: "Choisir le statut", type: "select" },
      { key: "photoUrl", label: "Photo", placeholder: "Ajouter une photo", type: "photo" },
    ],
  },
  announcements: {
    title: "Gestion des annonces",
    addLabel: "Ajouter une annonce",
    fields: [
      { key: "title", label: "Titre", placeholder: "Réunion des parents" },
      { key: "message", label: "Message", placeholder: "Votre message" },
      { key: "date", label: "Date", placeholder: "JJ-MM-AAAA", type: "date" },
    ],
  },
  messages: {
    title: "Messages parents",
    addLabel: "Écrire à un parent",
    fields: [
      { key: "parentPhone", label: "Parent", placeholder: "Choisir un parent", type: "select" },
      { key: "studentId", label: "Élève", placeholder: "Choisir un élève", type: "select" },
      { key: "theme", label: "Thème", placeholder: "Choisir un thème", type: "select" },
      { key: "priority", label: "Priorité", placeholder: "Choisir une priorité", type: "select" },
      { key: "message", label: "Message", placeholder: "Message au parent" },
      { key: "attachmentUrl", label: "Pièce jointe", placeholder: "Lien PDF, image, audio ou vidéo" },
      { key: "status", label: "Statut", placeholder: "Choisir le statut", type: "select" },
      { key: "date", label: "Date", placeholder: "JJ-MM-AAAA", type: "date" },
    ],
  },
};

export default function AdminCrudScreen({ route }: Props) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { entity, filter, className: scopedClassName } = route.params;
  const lockedClassName = scopedClassName?.trim() ?? "";
  const { session } = useAuth();
  const {
    getItems,
    createItem,
    updateItem,
    deleteItem,
    studentsData,
    teachersData,
    classesData,
    coursesData,
    assignmentsData,
    countriesData,
    paymentStatusesData,
    schoolsData,
    usersData,
    paymentsData,
    subscriptionsData,
    rolePermissionsData,
    updateRoleFeatureAccess,
    academicConfigData,
  } = useAdminData();
  const config = configs[entity];
  const items = getItems(entity);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(false);
  const [selectField, setSelectField] = useState<Field | null>(null);
  const [selectedCourseClass, setSelectedCourseClass] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [schoolTypeFilter, setSchoolTypeFilter] = useState("Tous");
  const [schoolCountryFilter, setSchoolCountryFilter] = useState("Tous");
  const [userRoleFilter, setUserRoleFilter] = useState("Tous");
  const [userStatusFilter, setUserStatusFilter] = useState("Tous");
  const [dateField, setDateField] = useState<Field | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarStep, setCalendarStep] = useState<"year" | "month" | "day">("year");
  const [selectedPermissionRole, setSelectedPermissionRole] = useState("");
  const [selectedPermissionFeature, setSelectedPermissionFeature] = useState("");
  const canCreate = canMutateEntity(session, entity, "CREATE");
  const canRead = canReadEntity(session, entity);
  const canUpdate = canMutateEntity(session, entity, "UPDATE");
  const canDelete = canMutateEntity(session, entity, "DELETE");
  const delegableFeatures = useMemo(
    () => schoolPilotageFeatures.filter((feature) => getDelegablePermissionsForFeature(session, feature).length > 0),
    [session?.permissions, session?.user.permissions]
  );
  const pilotageRoles = useMemo(() => getMobilePilotageRoles(usersData), [usersData]);

  useEffect(() => {
    if (!canRead) {
      setVisible(false);
      setSelectField(null);
      setDateField(null);
    }
  }, [canRead]);

  useEffect(() => {
    if (entity === "courses" && !selectedCourseClass && classesData.length > 0) {
      setSelectedCourseClass(classesData[0].name);
    }
  }, [classesData, entity, selectedCourseClass]);

  useEffect(() => {
    if (entity !== "users" || session?.role !== "school_admin") {
      return;
    }

    if (!selectedPermissionRole || !pilotageRoles.includes(selectedPermissionRole)) {
      setSelectedPermissionRole(pilotageRoles[0] ?? "");
    }
    if (!selectedPermissionFeature || !delegableFeatures.includes(selectedPermissionFeature)) {
      setSelectedPermissionFeature(delegableFeatures[0] ?? "");
    }
  }, [delegableFeatures, entity, pilotageRoles, selectedPermissionFeature, selectedPermissionRole, session?.role]);

  const visibleItems = useMemo(() => {
    if (entity === "courses" && selectedCourseClass) {
      return items.filter((item: any) => normalize(item.className) === normalize(selectedCourseClass));
    }

    if (entity === "schools") {
      const query = normalize(searchQuery);
      const type = normalize(schoolTypeFilter);
      const country = normalize(schoolCountryFilter);

      return items.filter((item: any) => {
        const matchesSearch =
          !query ||
          [item.name, item.code, item.city, item.country].some((value) =>
            normalize(value).includes(query)
          );
        const matchesType = schoolTypeFilter === "Tous" || normalize(item.type) === type;
        const matchesCountry = schoolCountryFilter === "Tous" || normalize(item.country) === country;

        return matchesSearch && matchesType && matchesCountry;
      });
    }

    if (entity === "users") {
      const query = normalize(searchQuery);

      return items.filter((item: any) => {
        const adminCreated = isAdminCreatedUser(item);
        const matchesSearch =
          !query ||
          [item.lastName, item.firstName, item.phone, item.identifier].some((value) =>
            normalize(value).includes(query)
          );
        const matchesRole = userRoleFilter === "Tous" || normalize(item.role) === normalize(userRoleFilter);
        const matchesStatus = userStatusFilter === "Tous" || normalize(item.status) === normalize(userStatusFilter);

        return canShowUserForSession(item, session) && matchesSearch && matchesRole && matchesStatus;
      });
    }

    if (entity === "payments" && filter) {
      return items.filter((item: any) => {
        const isPaid = item.status === "PAYE";
        return filter === "paid" ? isPaid : !isPaid;
      });
    }

    return items;
  }, [
    entity,
    filter,
    items,
    schoolCountryFilter,
    schoolTypeFilter,
    searchQuery,
    selectedCourseClass,
    userRoleFilter,
    userStatusFilter,
  ]);

  const statsLabel = useMemo(() => {
    if (entity === "payments" && filter === "pending") return `${visibleItems.length} impayé(s)`;
    if (entity === "payments" && filter === "paid") return `${visibleItems.length} paiement(s) payé(s)`;
    if (entity === "users") return `${visibleItems.filter(isActiveUserAccount).length} utilisateur(s) actif(s)`;
    return `${visibleItems.length} élément(s)`;
  }, [entity, filter, visibleItems]);

  const openCreate = () => {
    if (!canCreate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de créer cet élément.");
      return;
    }

    setEditingItem(null);
    const initialForm = getInitialForm(entity, {
      schoolsData,
      usersData,
      session,
    });
    setForm({
      ...initialForm,
      ...(entity === "courses" && selectedCourseClass
        ? { className: selectedCourseClass }
        : {}),
      ...(entity === "students" && lockedClassName ? { className: lockedClassName } : {}),
    });
    setVisible(true);
  };

  const openEdit = (item: any) => {
    if (!canUpdate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier cet élément.");
      return;
    }

    setEditingItem(item);
    setForm(itemToForm(entity, item));
    if (entity === "courses") {
      setSelectedCourseClass(item.className);
    }
    setVisible(true);
  };

  const save = () => {
    if (editingItem && !canUpdate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier cet élément.");
      return;
    }

    if (!editingItem && !canCreate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de créer cet élément.");
      return;
    }

    if (entity === "assignments" && form.assignmentType === studentClassAssignmentType) {
      const studentId = parseSelectId(form.studentId);
      const className = form.className;
      const student = studentsData.find((item) => matchesEntityId(item, studentId));
      const classExists = classesData.some((schoolClass) => normalize(schoolClass.name) === normalize(className));

      if (!studentId || !className || !student || !classExists) {
        Alert.alert("Affectation impossible", "Choisissez un élève et une classe de votre établissement.");
        return;
      }

      updateItem("students", {
        ...student,
        className,
        history: [
          ...((student as any).history ?? []),
          `Affecté à la classe ${className} le ${formatDate(new Date())}`,
        ],
      });
      setVisible(false);
      Alert.alert("Affectation enregistrée", `${student.name} est maintenant dans la classe ${className}.`);
      return;
    }

    const workingForm =
      entity === "students" && lockedClassName
        ? { ...form, className: lockedClassName }
        : form;

    const nextItem = formToItem(entity, workingForm, editingItem?.id, {
      studentsData,
      teachersData,
      classesData,
      coursesData,
      paymentsData,
      schoolsData,
      usersData,
      countriesData,
      subscriptionsData,
      session,
    });

    if (!nextItem) {
      Alert.alert("Formulaire incomplet", "Veuillez remplir les champs principaux.");
      return;
    }

    const businessError = validateBusinessRules({
      entity,
      item: nextItem,
      editingId: editingItem?.id,
      teachersData,
      classesData,
      coursesData,
      assignmentsData,
      schoolsData,
      studentsData,
      usersData,
      countriesData,
      subscriptionsData,
    });

    if (businessError) {
      Alert.alert("Règle métier", businessError);
      return;
    }

    if (editingItem) {
      updateItem(entity as any, nextItem as any);
    } else {
      createItem(entity as any, nextItem as any);
    }

    if (entity === "users") {
      const userItem = nextItem as UserAccount;
      if (isTeacherUserRole(userItem.role)) {
      const syncedTeachers = upsertTeacherFromUser(teachersData, userItem);
      const syncedTeacher = syncedTeachers.find(
        (teacher) =>
          String(teacher.userId ?? "") === String(userItem.id) ||
          normalize(String(teacher.identifier ?? "")) === normalize(String(userItem.identifier ?? ""))
      );
      if (syncedTeacher) {
        const existsInTeachers = teachersData.some(
          (teacher) => String(teacher.id) === String(syncedTeacher.id)
        );
        if (existsInTeachers) {
          updateItem("teachers", syncedTeacher);
        } else {
          createItem("teachers", syncedTeacher);
        }
      }
      }
    }

    if (entity === "assignments") {
      syncTeacherCourseAssignment(nextItem, editingItem);
    }

    if (entity === "courses") {
      setSelectedCourseClass(String(nextItem.className ?? ""));
      syncCourseTeacherAssignment(nextItem, editingItem);
    }

    setVisible(false);
  };

  const syncCourseTeacherAssignment = (course: any, previousCourse?: any) => {
    if (previousCourse?.teacherId) {
      removeTeacherCourseAssignment({
        teacherId: previousCourse.teacherId,
        className: previousCourse.className,
        course: previousCourse.name,
      });
      const previousAssignment = assignmentsData.find(
        (assignment: any) =>
          normalize(assignment.className) === normalize(previousCourse.className) &&
          normalize(assignment.course) === normalize(previousCourse.name)
      );
      if (previousAssignment?.id) {
        deleteItem("assignments", String(previousAssignment.id));
      }
    }

    const existingAssignment = assignmentsData.find(
      (assignment: any) =>
        normalize(assignment.className) === normalize(course.className) &&
        normalize(assignment.course) === normalize(course.name)
    );

    const assignmentPayload = {
      id: existingAssignment?.id ?? createInternalId("ASSIGN"),
      schoolCode: course.schoolCode,
      teacherId: course.teacherId,
      className: course.className,
      course: course.name,
    };

    if (existingAssignment) {
      updateItem("assignments", assignmentPayload);
    } else {
      createItem("assignments", assignmentPayload);
    }

    syncTeacherCourseAssignment(assignmentPayload, existingAssignment);
  };

  const confirmDelete = (item: any) => {
    if (!canDelete) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de supprimer cet élément.");
      return;
    }

    Alert.alert("Supprimer", "Confirmer la suppression ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: () => {
          if (entity === "classes") {
            const schoolCode = session?.user?.schoolCode ?? session?.school?.code;
            const stateForDelete = {
              students: studentsData,
              courses: coursesData,
              assignments: assignmentsData,
              classes: classesData,
              academicConfigs: academicConfigData?.schoolCode
                ? { [academicConfigData.schoolCode]: academicConfigData }
                : {},
            };
            const result = removeSchoolClassFromState(stateForDelete, item, schoolCode);
            if (!result.ok) {
              Alert.alert("Suppression refusée", result.error);
              return;
            }
          }

          deleteItem(entity, item.id);
          if (entity === "assignments") {
            removeTeacherCourseAssignment(item);
          }
        },
      },
    ]);
  };

  const syncTeacherCourseAssignment = (assignment: any, previousAssignment?: any) => {
    if (previousAssignment) {
      removeTeacherCourseAssignment(previousAssignment);
    }

    const teacher = teachersData.find((item) => matchesEntityId(item, assignment.teacherId));
    if (!teacher) return;

    const nextTeacherAssignments = [
      ...(teacher.assignments ?? []).filter(
        (item: any) =>
          normalize(item.className) !== normalize(assignment.className) ||
          normalize(item.course) !== normalize(assignment.course)
      ),
      { className: assignment.className, course: assignment.course, teacherId: teacher.id },
    ];

    updateItem("teachers", {
      ...teacher,
      assignments: nextTeacherAssignments,
      assignedClasses: [...new Set(nextTeacherAssignments.map((item: any) => item.className))],
    });
  };

  const removeTeacherCourseAssignment = (assignment: any) => {
    const teacher = teachersData.find((item) => matchesEntityId(item, assignment.teacherId));
    if (!teacher) return;

    const nextTeacherAssignments = (teacher.assignments ?? []).filter(
      (item: any) =>
        normalize(item.className) !== normalize(assignment.className) ||
        normalize(item.course) !== normalize(assignment.course)
    );

    updateItem("teachers", {
      ...teacher,
      assignments: nextTeacherAssignments,
      assignedClasses: [...new Set(nextTeacherAssignments.map((item: any) => item.className))],
    });
  };

  const resetUserPassword = async (item: any) => {
    if (!canUpdate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier ce compte.");
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    let savedUser = item;

    try {
      const response = await resetUserPasswordOnBackend(item.id, temporaryPassword);
      savedUser = response.user ?? item;
    } catch {
      // En mode hors ligne/démo, on conserve la mise à jour locale.
    }

    const nextItem = {
      ...item,
      ...savedUser,
      temporaryPassword,
      password: temporaryPassword,
      pin: temporaryPassword,
      passwordHash: undefined,
      pinHash: undefined,
      mustChangePassword: true,
      history: [
        ...(item.history ?? []),
        `Mot de passe temporaire régénéré le ${formatDate(new Date())}. Ancien mot de passe invalidé.`,
      ],
    };

    updateItem("users", nextItem);
    Alert.alert(
      "Mot de passe réinitialisé",
      `Nouveau mot de passe temporaire : ${temporaryPassword}\nL'ancien mot de passe ne fonctionne plus.`
    );
  };

  const choosePhotoSource = (field: Field) => {
    Alert.alert("Photo du compte", "Choisissez la source de la photo.", [
      { text: "Annuler", style: "cancel" },
      { text: "Importer une photo", onPress: () => uploadPhoto(field.key) },
      { text: "Prendre une photo", onPress: () => takePhoto(field.key) },
    ]);
  };

  const uploadPhoto = async (fieldKey: string) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission requise", "Autorisez l'accès aux photos pour importer une image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setForm((current) => ({ ...current, [fieldKey]: result.assets[0].uri }));
    }
  };

  const takePhoto = async (fieldKey: string) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission requise", "Autorisez l'accès à l'appareil photo pour prendre une photo.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setForm((current) => ({ ...current, [fieldKey]: result.assets[0].uri }));
    }
  };

  const selectedDelegablePermissions = getDelegablePermissionsForFeature(session, selectedPermissionFeature);
  const selectedRolePermissions = new Set(rolePermissionsData[selectedPermissionRole] ?? []);

  const togglePermissionAction = (permission: string, enabled: boolean) => {
    if (session?.role !== "school_admin") {
      Alert.alert("Accès refusé", "Seul l'admin établissement peut piloter ces droits.");
      return;
    }

    if (!selectedPermissionRole || !selectedPermissionFeature || !permission) {
      Alert.alert("Sélection incomplète", "Choisissez un rôle et une fonctionnalité accordée à votre compte.");
      return;
    }

    updateRoleFeatureAccess(
      selectedPermissionRole,
      selectedPermissionFeature,
      [permission],
      enabled
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {!canRead ? (
          <View style={styles.emptyState}>
            <Ionicons name="lock-closed-outline" size={24} color="#DC2626" />
            <Text style={styles.emptyText}>Accès refusé pour ce module.</Text>
          </View>
        ) : (
        <>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{getScreenTitle(config.title, entity, filter)}</Text>
            <Text style={styles.subtitle}>{statsLabel}</Text>
          </View>
          {canCreate && (
            <TouchableOpacity style={styles.addButton} onPress={openCreate} activeOpacity={0.85}>
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.addButtonText}>Ajouter</Text>
            </TouchableOpacity>
          )}
        </View>

        {entity === "users" && session?.role === "school_admin" && (
          <View style={styles.permissionPilotageCard}>
            <View style={styles.permissionPilotageHead}>
              <View style={styles.permissionIcon}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#2563EB" />
              </View>
              <View style={styles.permissionTitleBlock}>
                <Text style={styles.permissionTitle}>Droits par rôle</Text>
                <Text style={styles.permissionSubtitle}>
                  Activez uniquement les fonctionnalités accordées à votre établissement.
                </Text>
              </View>
            </View>

            <Text style={styles.blockLabel}>Rôle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {pilotageRoles.map((role) => (
                <TouchableOpacity
                  key={`pilotage-role-${role}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, selectedPermissionRole === role && styles.filterPillActive]}
                  onPress={() => setSelectedPermissionRole(role)}
                >
                  <Text style={[styles.filterText, selectedPermissionRole === role && styles.filterTextActive]}>
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.blockLabel}>Fonctionnalité</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {delegableFeatures.map((feature) => (
                <TouchableOpacity
                  key={`pilotage-feature-${feature}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, selectedPermissionFeature === feature && styles.filterPillActive]}
                  onPress={() => setSelectedPermissionFeature(feature)}
                >
                  <Text style={[styles.filterText, selectedPermissionFeature === feature && styles.filterTextActive]}>
                    {feature}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.selectedFeatureCard}>
              <View>
                <Text style={styles.permissionFeatureName}>{selectedPermissionFeature || "Aucune fonctionnalité"}</Text>
                <Text style={styles.permissionActions}>
                  {selectedPermissionRole || "Choisissez un rôle"}
                </Text>
              </View>

              <View style={styles.permissionCrudColumn}>
                {selectedDelegablePermissions.length ? (
                  selectedDelegablePermissions.map((permission) => {
                    const actionKey = permission.split(":")[1] as SecurityAction;
                    const label = rolePilotageActions.find((action) => action.key === actionKey)?.label ?? actionKey;
                    const enabled = selectedRolePermissions.has(permission);
                    return (
                      <View key={permission} style={styles.permissionCrudRow}>
                        <View style={styles.permissionCrudText}>
                          <Text style={styles.permissionCrudLabel}>{label}</Text>
                          <Text style={styles.permissionCrudStatus}>{enabled ? "Accordé" : "Refusé"}</Text>
                        </View>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          style={[styles.toggleButton, enabled && styles.toggleButtonActive]}
                          onPress={() => togglePermissionAction(permission, !enabled)}
                        >
                          <View style={[styles.toggleKnob, enabled && styles.toggleKnobActive]} />
                          <Text style={[styles.toggleButtonText, enabled && styles.toggleButtonTextActive]}>
                            {enabled ? "Oui" : "Non"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.permissionActions}>Aucun droit accordé par le niveau supérieur.</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {entity === "schools" && (
          <View style={styles.filtersCard}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Rechercher nom, code, ville ou pays"
                style={styles.searchInput}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {["Tous", ...new Set(schoolsData.map((item) => item.type).filter(Boolean))].map((type) => (
                <TouchableOpacity
                  key={`type-${type}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, schoolTypeFilter === type && styles.filterPillActive]}
                  onPress={() => setSchoolTypeFilter(type)}
                >
                  <Text style={[styles.filterText, schoolTypeFilter === type && styles.filterTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {["Tous", ...new Set(schoolsData.map((item) => item.country).filter(Boolean))].map((country) => (
                <TouchableOpacity
                  key={`country-${country}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, schoolCountryFilter === country && styles.filterPillActive]}
                  onPress={() => setSchoolCountryFilter(country)}
                >
                  <Text style={[styles.filterText, schoolCountryFilter === country && styles.filterTextActive]}>
                    {country}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {entity === "users" && (
          <View style={styles.filtersCard}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Rechercher nom, téléphone ou identifiant"
                style={styles.searchInput}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {["Tous", ...getManageableSchoolUserRoles()].map((role) => (
                <TouchableOpacity
                  key={`role-${role}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, userRoleFilter === role && styles.filterPillActive]}
                  onPress={() => setUserRoleFilter(role)}
                >
                  <Text style={[styles.filterText, userRoleFilter === role && styles.filterTextActive]}>
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {["Tous", "Actif", "Suspendu", "Désactivé"].map((status) => (
                <TouchableOpacity
                  key={`user-status-${status}`}
                  activeOpacity={0.85}
                  style={[styles.filterPill, userStatusFilter === status && styles.filterPillActive]}
                  onPress={() => setUserStatusFilter(status)}
                >
                  <Text style={[styles.filterText, userStatusFilter === status && styles.filterTextActive]}>
                    {status}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {entity === "courses" && (
          <View style={styles.classCardsBlock}>
            <Text style={styles.blockLabel}>Choisir une classe</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.classCardsList}
            >
              {classesData.map((schoolClass) => {
                const selected = normalize(schoolClass.name) === normalize(selectedCourseClass);
                const courseCount = items.filter(
                  (item: any) => normalize(item.className) === normalize(schoolClass.name)
                ).length;

                return (
                  <TouchableOpacity
                    key={schoolClass.id}
                    activeOpacity={0.85}
                    style={[styles.classCard, selected && styles.classCardSelected]}
                    onPress={() => setSelectedCourseClass(schoolClass.name)}
                  >
                    <Text style={[styles.classCardTitle, selected && styles.classCardTitleSelected]}>
                      {schoolClass.name}
                    </Text>
                    <Text style={[styles.classCardMeta, selected && styles.classCardMetaSelected]}>
                      {courseCount} cours
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.courseHeader}>
              <Text style={styles.courseHeaderTitle}>
                Cours de {selectedCourseClass || "la classe"}
              </Text>
              <Text style={styles.courseHeaderMeta}>{visibleItems.length} cours</Text>
            </View>
          </View>
        )}

        {entity === "users" ? (
          <View style={styles.userList}>
            {visibleItems.map((item: any) => (
              <View key={item.id} style={styles.userListRow}>
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{getUserInitials(item)}</Text>
                </View>
                <View style={styles.userListContent}>
                  <View style={styles.userListTopLine}>
                    <Text style={styles.userListName} numberOfLines={1}>
                      {getPrimaryText(entity, item)}
                    </Text>
                    <View style={[styles.userStatusBadge, isActiveUserAccount(item) ? styles.userStatusActive : styles.userStatusInactive]}>
                      <Text style={[styles.userStatusText, isActiveUserAccount(item) ? styles.userStatusTextActive : styles.userStatusTextInactive]}>
                        {item.status || "Actif"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.userListRole} numberOfLines={1}>{item.role}</Text>
                  <Text style={styles.userListMeta} numberOfLines={1}>
                    {item.identifier || "Identifiant non renseigné"} • {item.accessChannel || "Application"}
                  </Text>
                  {item.temporaryPassword ? (
                    <Text style={styles.userTempPassword} numberOfLines={1}>
                      Mot de passe temporaire : {item.temporaryPassword}
                    </Text>
                  ) : null}
                  <View style={styles.userListActions}>
                    {canUpdate && (
                      <TouchableOpacity style={styles.listActionButton} onPress={() => openEdit(item)}>
                        <Ionicons name="create-outline" size={17} color="#2563EB" />
                        <Text style={styles.listActionText}>Modifier</Text>
                      </TouchableOpacity>
                    )}
                    {canUpdate && (
                      <TouchableOpacity style={styles.listActionButtonWarning} onPress={() => resetUserPassword(item)}>
                        <Ionicons name="key-outline" size={17} color="#B45309" />
                        <Text style={styles.listActionTextWarning}>Mot de passe</Text>
                      </TouchableOpacity>
                    )}
                    {canDelete && (
                      <TouchableOpacity style={styles.listActionButtonDanger} onPress={() => confirmDelete(item)}>
                        <Ionicons name="trash-outline" size={17} color="#DC2626" />
                        <Text style={styles.listActionTextDanger}>Supprimer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : (
          visibleItems.map((item: any) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{getPrimaryText(entity, item)}</Text>
                <Text style={styles.cardMeta}>{getSecondaryText(entity, item, { assignmentsData, classesData })}</Text>
              </View>
              {canUpdate && (
                <TouchableOpacity style={styles.iconButton} onPress={() => openEdit(item)}>
                  <Ionicons name="create-outline" size={20} color="#2563EB" />
                </TouchableOpacity>
              )}
              {canDelete && (
                <TouchableOpacity style={styles.iconButtonDanger} onPress={() => confirmDelete(item)}>
                  <Ionicons name="trash-outline" size={20} color="#DC2626" />
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        {visibleItems.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="book-outline" size={22} color="#94A3B8" />
            <Text style={styles.emptyText}>Aucun élément pour cette sélection</Text>
          </View>
        )}
        </>
        )}
      </ScrollView>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingItem ? "Modifier" : config.addLabel}</Text>

            <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
              {config.fields.map((field) => (
                shouldHideField(entity, form, field) ? null : (
                <View key={field.key} style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  {field.type === "select" ? (
                    entity === "students" && lockedClassName && field.key === "className" ? (
                      <View style={[styles.selectInput, styles.selectInputLocked]}>
                        <Text style={styles.selectText}>{lockedClassName}</Text>
                        <Ionicons name="lock-closed-outline" size={16} color="#94A3B8" />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.selectInput}
                        activeOpacity={0.85}
                        onPress={() => setSelectField(field)}
                      >
                        <Text
                          style={[
                            styles.selectText,
                            !form[field.key] && styles.selectPlaceholder,
                          ]}
                        >
                          {form[field.key] || field.placeholder}
                        </Text>
                        <Ionicons name="chevron-down" size={18} color="#64748B" />
                      </TouchableOpacity>
                    )
                  ) : field.type === "date" ? (
                    <TouchableOpacity
                      style={styles.selectInput}
                      activeOpacity={0.85}
                      onPress={() => {
                        setCalendarMonth(getInitialCalendarDate(field, form[field.key]));
                        setCalendarStep("year");
                        setDateField(field);
                      }}
                    >
                      <Text
                        style={[
                          styles.selectText,
                          !form[field.key] && styles.selectPlaceholder,
                        ]}
                      >
                        {form[field.key] || field.placeholder}
                      </Text>
                      <Ionicons name="calendar-outline" size={18} color="#64748B" />
                    </TouchableOpacity>
                  ) : field.type === "photo" ? (
                    <View style={styles.photoField}>
                      {form[field.key] ? (
                        <View style={styles.photoPreviewRow}>
                          <Image source={{ uri: form[field.key] }} style={styles.photoPreview} />
                          <View style={styles.photoMeta}>
                            <Text style={styles.photoTitle}>Photo sélectionnée</Text>
                            <Text style={styles.photoSubtitle} numberOfLines={1}>
                              {form[field.key]}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.photoRemoveButton}
                            activeOpacity={0.85}
                            onPress={() => setForm((current) => ({ ...current, [field.key]: "" }))}
                          >
                            <Ionicons name="close" size={18} color="#DC2626" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Text style={styles.photoHelp}>Aucune photo sélectionnée</Text>
                      )}

                      <TouchableOpacity
                        style={styles.photoButton}
                        activeOpacity={0.85}
                        onPress={() => choosePhotoSource(field)}
                      >
                        <Ionicons name="camera-outline" size={18} color="#2563EB" />
                        <Text style={styles.photoButtonText}>{field.placeholder}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TextInput
                      value={form[field.key] ?? ""}
                      onChangeText={(value) => setForm((current) => ({ ...current, [field.key]: value }))}
                      placeholder={field.placeholder}
                      keyboardType={field.keyboardType ?? "default"}
                      style={styles.input}
                    />
                  )}
                </View>
                )
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setVisible(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={save}>
                <Text style={styles.saveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectField)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectField(null)}
      >
        <View style={styles.selectorBackdrop}>
          <View style={styles.selectorCard}>
            <Text style={styles.selectorTitle}>{selectField?.label}</Text>
            <ScrollView style={styles.selectorList}>
              {getSelectOptions(
                selectField?.key,
                entity,
                studentsData,
                teachersData,
                classesData,
                coursesData,
                paymentStatusesData,
                schoolsData,
                usersData,
                countriesData,
                form,
                academicConfigData,
                editingItem?.id
              ).map((option, index) => (
                <TouchableOpacity
                  key={`${selectField?.key ?? "option"}-${option}-${index}`}
                  style={styles.selectorOption}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (selectField) {
                      setForm((current) => ({
                        ...current,
                        [selectField.key]: option,
        ...(entity === "assignments" && selectField.key === "assignmentType"
          ? option === studentClassAssignmentType
            ? { teacherId: "", course: "" }
            : { studentId: "" }
          : {}),
        ...(entity === "users" && selectField.key === "role"
          ? {
              ...getRoleDefaults(option, form.schoolCode || getDefaultSchoolCode(schoolsData, session)),
              identifier: generateUserIdentifier(usersData, option),
            }
          : {}),
                        ...(entity === "assignments" && selectField.key === "className"
                          ? { course: "" }
                          : {}),
                      }));
                    }
                    setSelectField(null);
                  }}
                >
                  <Text style={styles.selectorOptionText}>{formatSelectOptionLabel(selectField?.key ?? "", option)}</Text>
                  {form[selectField?.key ?? ""] === option && (
                    <Ionicons name="checkmark-circle" size={20} color="#2563EB" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.selectorCancel} onPress={() => setSelectField(null)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(dateField)}
        transparent
        animationType="fade"
        onRequestClose={() => setDateField(null)}
      >
        <View style={styles.selectorBackdrop}>
          <View style={styles.selectorCard}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity
                style={styles.calendarNav}
                onPress={() => {
                  if (calendarStep === "year") {
                    setDateField(null);
                    return;
                  }
                  setCalendarStep(calendarStep === "day" ? "month" : "year");
                }}
              >
                <Ionicons name={calendarStep === "year" ? "close" : "chevron-back"} size={20} color="#0F172A" />
              </TouchableOpacity>
              <View style={styles.calendarTitleBox}>
                <Text style={styles.selectorTitle}>{getCalendarStepTitle(calendarStep, calendarMonth)}</Text>
                <Text style={styles.calendarSubtitle}>{getCalendarStepSubtitle(calendarStep)}</Text>
              </View>
              <TouchableOpacity
                style={styles.calendarNav}
                onPress={() => setDateField(null)}
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {calendarStep === "year" && (
              <ScrollView style={styles.calendarStepScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.yearGrid}>
                  {buildYearOptions(dateField, calendarMonth).map((year) => {
                    const selected = year === calendarMonth.getFullYear();
                    return (
                      <TouchableOpacity
                        key={`year-${year}`}
                        style={[styles.yearChip, selected && styles.yearChipActive]}
                        activeOpacity={0.85}
                        onPress={() => {
                          setCalendarMonth(setCalendarYear(calendarMonth, year));
                          setCalendarStep("month");
                        }}
                      >
                        <Text style={[styles.yearChipText, selected && styles.yearChipTextActive]}>
                          {year}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {calendarStep === "month" && (
              <View style={styles.monthGrid}>
                {monthNames.map((month, index) => {
                  const selected = index === calendarMonth.getMonth();
                  return (
                    <TouchableOpacity
                      key={month}
                      style={[styles.monthChip, selected && styles.monthChipActive]}
                      activeOpacity={0.85}
                      onPress={() => {
                        setCalendarMonth(setCalendarMonthIndex(calendarMonth, index));
                        setCalendarStep("day");
                      }}
                    >
                      <Text style={[styles.monthChipText, selected && styles.monthChipTextActive]}>
                        {month}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {calendarStep === "day" && (
              <>
                <View style={styles.weekRow}>
                  {["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"].map((day) => (
                    <Text key={day} style={styles.weekDay}>{day}</Text>
                  ))}
                </View>

                <View style={styles.daysGrid}>
                  {buildCalendarDays(calendarMonth).map((day, index) => {
                    const selectedDate = dateField ? parseDisplayDate(form[dateField.key]) : null;
                    const selected = Boolean(day && selectedDate && isSameDate(day, selectedDate));
                    return (
                      <TouchableOpacity
                        key={`${day?.toISOString() ?? "empty"}-${index}`}
                        disabled={!day}
                        style={[styles.dayCell, !day && styles.dayCellEmpty]}
                        onPress={() => {
                          if (day && dateField) {
                            setForm((current) => ({ ...current, [dateField.key]: formatDate(day) }));
                          }
                          setDateField(null);
                        }}
                      >
                        <Text style={[styles.dayText, selected && styles.dayTextActive]}>{day ? day.getDate() : ""}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <TouchableOpacity style={styles.selectorCancel} onPress={() => setDateField(null)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function itemToForm(entity: AdminEntity, item: any) {
  if (entity === "assignments") {
    return {
      ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value ?? "")])),
      assignmentType: teacherCourseAssignmentType,
    };
  }

  if (entity === "courses" && item.teacherId) {
    return {
      ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value ?? "")])),
      teacherId: formatSelectOption(String(item.teacherId), String(item.teacherName ?? "")),
    };
  }

  if (entity === "users") {
    return {
      ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value ?? "")])),
      secondaryRoles: (item.secondaryRoles ?? []).join(", "),
    };
  }

  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, String(value)])
  );
}

function getInitialForm(entity: AdminEntity, context?: any): Record<string, string> {
  if (entity === "assignments") {
    return { assignmentType: teacherCourseAssignmentType };
  }

  if (entity === "users") {
    const schoolCode = getDefaultSchoolCode(context?.schoolsData ?? [], context?.session);
    const role = "Secrétaire";
    return {
      gender: "Non renseigné",
      role,
      ...getRoleDefaults(role, schoolCode),
      schoolCode,
      accessChannel: "Application",
      identifier: generateUserIdentifier(context?.usersData ?? [], role),
      status: "Actif",
      temporaryPassword: generateTemporaryPassword(),
      createdBy: context?.session?.user?.name ?? "Administrateur",
    };
  }

  return {};
}

function formToItem(entity: AdminEntity, form: Record<string, string>, id?: string, context?: any) {
  const nextId = id ?? createInternalId(entity);
  const year = String(new Date().getFullYear());
  const schoolCode = context?.schoolsData?.[0]?.code ?? "CD-2026-0001";

  if (entity === "students") {
    if (!form.name || !form.className) return null;
    const publicId = form.matricule || generateLearnerPublicId(schoolCode, context?.studentsData ?? []);
    return {
      id: nextId,
      publicId,
      schoolCode,
      name: form.name,
      firstName: form.firstName ?? "",
      matricule: publicId,
      gender: form.gender || "Non renseigné",
      birthDate: form.birthDate || "",
      className: form.className,
      parentName: form.parentName ?? "",
      parentPhone: form.parentPhone ?? "",
      parentEmail: form.parentEmail ?? "",
      archived: false,
    };
  }

  if (entity === "teachers") {
    if (!form.name || !form.phone) return null;
    const publicId = form.publicId || generateTeacherPublicId(schoolCode, context?.teachersData ?? []);
    const identifier = String(publicId).match(/ENS-\d+$/i)?.[0]?.toUpperCase() ?? publicId;
    return {
      id: nextId,
      publicId,
      identifier,
      schoolCode,
      name: form.name,
      firstName: form.firstName ?? "",
      gender: form.gender || "Non renseigné",
      phone: form.phone,
      email: "",
      mainSubject: form.mainSubject ?? "",
      assignments: [],
    };
  }

  if (entity === "classes") {
    if (!form.name) return null;
    return {
      id: nextId,
      publicId: form.publicId || generatePublicId("CLS", year, context?.classesData ?? [], 6),
      schoolCode,
      name: form.name,
      level: form.level ?? "",
      track: form.track ?? "",
      teacherId: form.teacherId ?? "",
    };
  }

  if (entity === "countries") {
    if (!form.name || !form.code || !form.phonePrefix || !form.currency) return null;
    const code = form.code.trim().toUpperCase();

    return {
      id: id ?? `COUNTRY-${code}`,
      name: form.name,
      code,
      phonePrefix: form.phonePrefix,
      currency: form.currency.trim().toUpperCase(),
      timezone: form.timezone || "Africa/Kinshasa",
      status: form.status || "Actif",
      administratorId: form.administratorId ?? "",
      createdAt: form.createdAt || formatDate(new Date()),
    };
  }

  if (entity === "courses") {
    if (!form.className || !form.name || !form.teacherId) return null;
    const teacherId = parseSelectId(form.teacherId);
    const teacher = (context?.teachersData ?? []).find((item: any) => matchesEntityId(item, teacherId));
    return {
      id: nextId,
      publicId: form.publicId || generatePublicId("COU", year, context?.coursesData ?? [], 6),
      schoolCode,
      className: form.className,
      name: form.name,
      coefficient: Number(form.coefficient) || 1,
      teacherId,
      teacherName: teacher?.name ?? "",
    };
  }

  if (entity === "assignments") {
    if (!form.teacherId || !form.className || !form.course) return null;
    const teacherId = parseSelectId(form.teacherId);
    return {
      id: nextId,
      schoolCode,
      teacherId,
      className: form.className,
      course: form.course,
    };
  }

  if (entity === "payments") {
    if (!form.studentId || !form.amount) return null;
    return {
      id: nextId,
      publicId: form.publicId || generatePublicId("PAY", year, context?.paymentsData ?? [], 6),
      schoolCode,
      studentId: form.studentId,
      amount: Number(form.amount) || 0,
      date: form.date || formatDate(new Date()),
      status: form.status || "PAYE",
      method: form.method || "Mobile Money",
    };
  }

  if (entity === "subscriptions") {
    if (!form.schoolCode || !form.plan) return null;
    const school = (context?.schoolsData ?? []).find((item: any) => item.code === form.schoolCode);
    const country = form.country || school?.country || "";
    const countryCode = form.countryCode || getCountryCode(country);
    const currency = form.currency || school?.currency || "USD";

    return {
      id: id ?? `SUB-${form.schoolCode}`,
      schoolCode: form.schoolCode,
      countryCode,
      country,
      plan: form.plan,
      monthlyPrice: Number(form.monthlyPrice) || 0,
      annualPrice: Number(form.annualPrice) || 0,
      currency,
      status: form.status || "Actif",
      paymentStatus: form.paymentStatus || "À jour",
      startDate: form.startDate || formatDate(new Date()),
      endDate: form.endDate || formatDate(addMonths(new Date(), 12)),
      lastPaymentDate: form.lastPaymentDate || "",
    };
  }

  if (entity === "paymentStatuses") {
    if (!form.label || !form.value) return null;
    return {
      id: nextId,
      schoolCode,
      label: form.label,
      value: form.value.trim().toUpperCase().replace(/\s+/g, "_"),
    };
  }

  if (entity === "schools") {
    if (
      !form.name ||
      !form.type ||
      !form.country ||
      !form.city ||
      !form.address ||
      !form.phone ||
      !form.email
    ) {
      return null;
    }
    const code = form.code?.trim().toUpperCase() || generateSchoolCode(form.country, year, context?.schoolsData ?? []);

    return {
      id: id ?? createInternalId("school"),
      publicId: code,
      code,
      name: form.name,
      type: form.type,
      city: form.city,
      country: form.country,
      address: form.address,
      phone: form.phone,
      email: form.email,
      website: form.website ?? "",
      currency: form.currency || "CDF",
      slogan: form.slogan ?? "",
      status: form.status || "Actif",
      logoUrl: form.logoUrl ?? "",
      schoolYear: form.schoolYear || "2025-2026",
      timezone: form.timezone || "Africa/Kinshasa",
      language: form.language || "Français",
      dateFormat: form.dateFormat || "JJ-MM-AAAA",
      primaryColor: form.primaryColor || "#2563EB",
      subscriptionPlan: form.subscriptionPlan || "Essentiel",
      subscriptionStartDate: form.subscriptionStartDate || formatDate(new Date()),
      subscriptionEndDate: form.subscriptionEndDate || formatDate(addMonths(new Date(), 12)),
      maxStudents: Number(form.maxStudents) || 500,
      maxTeachers: Number(form.maxTeachers) || 50,
      createdAt: form.createdAt || formatDate(new Date()),
      validationStatus:
        context?.session?.role === "country_admin" && !id ? PENDING_VALIDATION_STATUS : form.validationStatus,
      validationRequestedBy:
        context?.session?.role === "country_admin" && !id ? context?.session?.user?.name : form.validationRequestedBy,
    };
  }

  if (entity === "users") {
    const userSchoolCode = form.schoolCode || schoolCodeFromContext(context);
    const defaults = getRoleDefaults(form.role, userSchoolCode);
    const isCreating = !id;
    const generatedTemporaryPassword = isCreating ? form.temporaryPassword || generateTemporaryPassword() : "";
    if (
      !form.lastName ||
      !form.firstName ||
      !form.role ||
      isPlatformUserRole(form.role) ||
      !userSchoolCode
    ) {
      return null;
    }

    const permissions = rolePermissions[form.role] ?? [];
    const publicId = form.publicId || generatePublicId("USR", year, context?.usersData ?? [], 6);
    const identifier = form.identifier?.trim() || generateUserIdentifier(context?.usersData ?? [], form.role);

    return {
      id: id ?? `USER-${Date.now()}`,
      publicId,
      lastName: form.lastName,
      firstName: form.firstName,
      gender: form.gender,
      phone: form.phone,
      email: "",
      role: form.role,
      secondaryRoles: splitList(form.secondaryRoles),
      scopeLevel: form.scopeLevel || defaults.scopeLevel,
      countryScope: form.countryScope ?? "",
      schoolCode: userSchoolCode,
      accessChannel: form.accessChannel || defaults.accessChannel,
      identifier,
      status: form.status || "Actif",
      permissions,
      temporaryPassword: isCreating ? generatedTemporaryPassword : form.temporaryPassword ?? "",
      ...(isCreating
        ? { password: generatedTemporaryPassword, pin: generatedTemporaryPassword, mustChangePassword: true }
        : { mustChangePassword: form.mustChangePassword === "true" }),
      photoUrl: form.photoUrl ?? "",
      createdAt: form.createdAt || formatDate(new Date()),
      lastLoginAt: form.lastLoginAt ?? "",
      createdBy: form.createdBy || context?.session?.user?.name || "Administrateur",
      history: [
        ...(splitList(form.history).length ? splitList(form.history) : []),
        `${id ? "Compte modifié" : `Compte créé avec identifiant ${identifier} et mot de passe temporaire ${generatedTemporaryPassword}`} le ${formatDate(new Date())}`,
      ],
    };
  }

  if (entity === "messages") {
    if (!form.parentPhone || !form.theme || !form.message) return null;
    return {
      id: nextId,
      schoolCode,
      parentPhone: form.parentPhone,
      studentId: form.studentId ?? "",
      teacherId: "",
      theme: form.theme,
      direction: "École vers parent",
      message: form.message,
      attachmentUrl: form.attachmentUrl ?? "",
      priority: form.priority || "Moyenne",
      status: form.status || "Envoyé",
      date: form.date || formatDate(new Date()),
      sentAt: `${form.date || formatDate(new Date())} 00:00`,
      audit: [
        {
          action: id ? "Modification" : "Création",
          actorId: "ADMIN1",
          date: `${formatDate(new Date())} 00:00`,
        },
      ],
    };
  }

  if (!form.title || !form.message) return null;
  return {
    id: nextId,
    schoolCode,
    title: form.title,
    message: form.message,
    date: form.date || formatDate(new Date()),
  };
}

function getPrimaryText(entity: AdminEntity, item: any) {
  if (entity === "countries") return `${item.name} • ${item.code}`;
  if (entity === "subscriptions") return `${item.schoolCode} • ${item.plan}`;
  if (entity === "payments") return `${item.amount?.toLocaleString?.() ?? item.amount} FC`;
  if (entity === "paymentStatuses") return item.label;
  if (entity === "schools") return `${item.name} • ${item.publicId ?? item.code}`;
  if (entity === "users") return `${item.firstName} ${item.lastName}`;
  if (entity === "announcements") return item.title;
  if (entity === "assignments") return `${item.className} - ${item.course}`;
  if (entity === "messages") return item.theme;
  return item.name;
}

function getScreenTitle(baseTitle: string, entity: AdminEntity, filter?: string) {
  if (entity === "payments" && filter === "pending") return "Gestion des impayés";
  if (entity === "payments" && filter === "paid") return "Paiements payés";
  return baseTitle;
}

function getSecondaryText(
  entity: AdminEntity,
  item: any,
  context?: { assignmentsData?: any[]; classesData?: any[] },
) {
  if (entity === "students") return `${item.publicId ?? item.matricule} • ${item.gender ?? "Sexe non renseigné"} • ${item.className} • Parent : ${item.parentPhone}`;
  if (entity === "teachers") {
    const classes = formatTeacherClasses(item, {
      assignments: context?.assignmentsData ?? [],
      classes: context?.classesData ?? [],
    });
    return `ID : ${item.publicId ?? item.id} • ${item.mainSubject ?? "Matière non renseignée"} • Classes : ${classes} • ${item.phone}`;
  }
  if (entity === "classes") return `${item.publicId ?? item.id} • ${item.level ?? "Niveau non renseigné"} • ${item.track ?? "Filière non renseignée"} • Responsable : ${item.teacherId || "Non assigné"}`;
  if (entity === "countries") return `${item.phonePrefix} • ${item.currency} • ${item.timezone} • ${item.status}`;
  if (entity === "courses") return `${item.publicId ?? item.id} • ${item.className} • Prof : ${item.teacherName || item.teacherId || "Non assigné"} • Coef. ${item.coefficient}`;
  if (entity === "assignments") return `Enseignant : ${item.teacherId}`;
  if (entity === "subscriptions") return `${item.country} • ${item.monthlyPrice} ${item.currency}/mois • ${item.paymentStatus} • fin ${item.endDate}`;
  if (entity === "paymentStatuses") return `Code : ${item.value}`;
  if (entity === "schools") {
    return `${item.type} • ${item.city}, ${item.country} • ${item.status} • ${item.maxStudents} élèves / ${item.maxTeachers} enseignants`;
  }
  if (entity === "users") {
    return `${item.role} • ${item.accessChannel} • ${item.status} • Identifiant : ${item.identifier}${item.temporaryPassword ? ` • Mot de passe temporaire : ${item.temporaryPassword}` : ""}`;
  }
  if (entity === "payments") return `${item.publicId ?? item.id} • Élève ${item.studentId} • ${item.date} • ${item.status} • ${item.method ?? "Mode non renseigné"}`;
  if (entity === "messages") {
    return `${item.direction} • ${item.parentPhone} • ${item.status} • ${item.date}`;
  }
  return `${item.date} • ${item.message}`;
}

type BusinessValidationInput = {
  entity: AdminEntity;
  item: any;
  editingId?: string;
  teachersData: any[];
  classesData: any[];
  coursesData: any[];
  assignmentsData: any[];
  schoolsData: any[];
  studentsData: any[];
  usersData: any[];
  countriesData: any[];
  subscriptionsData: any[];
};

function validateBusinessRules({
  entity,
  item,
  editingId,
  teachersData,
  classesData,
  coursesData,
  assignmentsData,
  schoolsData,
  studentsData,
  usersData,
  countriesData,
  subscriptionsData,
}: BusinessValidationInput) {
  if (entity === "users") {
    const identifier = normalize(item.identifier);
    const phone = normalize(item.phone);
    const schoolExists = schoolsData.some((schoolItem) => normalize(schoolItem.code) === normalize(item.schoolCode));
    const duplicateIdentifier = usersData.find(
      (user) =>
        user.id !== editingId &&
        normalize(user.schoolCode) === normalize(item.schoolCode) &&
        normalize(user.identifier) === identifier
    );
    const duplicatePhone = phone
      ? usersData.find(
          (user) =>
            user.id !== editingId &&
            normalize(user.schoolCode) === normalize(item.schoolCode) &&
            normalize(user.phone) === phone
        )
      : null;

    if (isPlatformUserRole(item.role)) {
      return "Utilisateur impossible : ce rôle n'est pas géré dans l'établissement.";
    }

    if (item.role === "Admin Pays" && !item.countryScope) {
      return "Utilisateur impossible : un Admin Pays doit être rattaché à un pays.";
    }

    if (!isGlobalOrCountryRole(item.role) && !schoolExists) {
      return "Utilisateur impossible : l'établissement sélectionné n'existe pas.";
    }

    if (duplicateIdentifier) {
      return "Utilisateur impossible : cet identifiant est déjà utilisé dans cet établissement.";
    }

    if (duplicatePhone) {
      return "Utilisateur impossible : ce téléphone est déjà utilisé par un autre compte.";
    }

    if (isTeacherUserRole(item.role)) {
      const teacherConflict = teachersData.find(
        (teacher) =>
          normalize(teacher.identifier) === identifier &&
          teacher.userId &&
          String(teacher.userId) !== String(item.id ?? editingId ?? "")
      );
      if (teacherConflict) {
        return "Utilisateur impossible : cet identifiant est déjà attribué à un autre enseignant.";
      }
    }

    if (item.photoUrl && !isValidPhotoReference(item.photoUrl)) {
      return "Photo impossible : veuillez choisir une image ou utiliser une URL valide.";
    }

    return null;
  }

  if (entity === "countries") {
    const duplicateCountry = countriesData.find(
      (country) => country.id !== editingId && normalize(country.code) === normalize(item.code)
    );

    if (duplicateCountry) {
      return "Création impossible : ce code pays existe déjà.";
    }

    return null;
  }

  if (entity === "subscriptions") {
    const duplicateSubscription = subscriptionsData.find(
      (subscription) =>
        subscription.id !== editingId && normalize(subscription.schoolCode) === normalize(item.schoolCode)
    );

    if (duplicateSubscription) {
      return "Abonnement impossible : cet établissement possède déjà un abonnement.";
    }

    if (!schoolsData.some((schoolItem) => normalize(schoolItem.code) === normalize(item.schoolCode))) {
      return "Abonnement impossible : l'établissement sélectionné n'existe pas.";
    }

    const endDate = parseDisplayDate(item.endDate);

    if (endDate && endDate.getTime() < Date.now() && item.status === "Actif") {
      return "Abonnement impossible : un abonnement actif doit avoir une date de fin future.";
    }

    return null;
  }

  if (entity === "schools") {
    const code = normalize(item.code);
    const duplicateCode = schoolsData.find(
      (schoolItem) => schoolItem.id !== editingId && normalize(schoolItem.code) === code
    );

    if (duplicateCode) {
      return "Création impossible : ce code établissement existe déjà.";
    }

    if (item.logoUrl && !/\.(jpg|jpeg|png|webp)$/i.test(item.logoUrl)) {
      return "Logo impossible : le fichier doit être au format JPG, PNG ou WebP.";
    }

    if (Number(item.maxStudents) < studentsData.length) {
      return `Abonnement impossible : la limite élèves (${item.maxStudents}) est inférieure à l'effectif actuel (${studentsData.length}).`;
    }

    if (Number(item.maxTeachers) < teachersData.length) {
      return `Abonnement impossible : la limite enseignants (${item.maxTeachers}) est inférieure à l'effectif actuel (${teachersData.length}).`;
    }

    const endDate = parseDisplayDate(item.subscriptionEndDate);

    if (endDate && endDate.getTime() < Date.now()) {
      return "Abonnement expiré : la date de fin doit être future pour un établissement actif.";
    }

    return null;
  }

  if (entity === "classes") {
    const className = normalize(item.name);
    if (!className) {
      return "Classe impossible : le nom de la classe est requis.";
    }

    const duplicateClass = classesData.find(
      (schoolClass) =>
        normalize(schoolClass.name) === className &&
        String(schoolClass.id ?? "") !== String(editingId ?? "")
    );
    if (duplicateClass) {
      return `Classe impossible : « ${item.name} » existe déjà dans l'établissement.`;
    }

    const teacherId = normalize(item.teacherId);

    if (!teacherId) {
      return null;
    }

    const teacherExists = teachersData.some(
      (teacher) => normalize(teacher.id) === teacherId || normalize(teacher.publicId) === teacherId
    );

    if (!teacherExists) {
      return "Classe impossible : cet ID responsable n'est pas enregistré dans les enseignants.";
    }

    return null;
  }

  if (entity !== "assignments" && entity !== "courses") {
    return null;
  }

  if (entity === "courses") {
    return validateCourseTeacherRule(item, coursesData, assignmentsData, editingId);
  }

  if (entity !== "assignments") {
    return null;
  }

  const teacherId = normalize(item.teacherId);
  const className = normalize(item.className);
  const course = normalize(item.course);
  const teacherExists = teachersData.some(
    (teacher) => normalize(teacher.id) === teacherId || normalize(teacher.publicId) === teacherId
  );
  const classExists = classesData.some((schoolClass) => normalize(schoolClass.name) === className);
  const courseExists = coursesData.some(
    (courseItem) =>
      normalize(courseItem.name) === course &&
      normalize(courseItem.className) === className
  );

  if (!teacherExists) {
    return "Affectation impossible : cet ID enseignant n'est pas enregistré dans le système.";
  }

  if (!courseExists) {
    return "Affectation impossible : ce cours n'existe pas dans le système.";
  }

  if (!classExists) {
    return "Affectation impossible : cette classe n'existe pas dans le système.";
  }

  const duplicate = assignmentsData.find(
    (assignment) =>
      assignment.id !== editingId &&
      normalize(assignment.className) === className &&
      normalize(assignment.course) === course
  );

  if (duplicate) {
    if (normalize(duplicate.teacherId) === teacherId) {
      return `Affectation impossible : cet enseignant est déjà affecté au cours ${item.course} pour la classe ${item.className}.`;
    }

    return `Affectation impossible : le cours ${item.course} est déjà affecté à un autre professeur pour la classe ${item.className}.`;
  }

  return null;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseSelectId(value?: string) {
  return String(value ?? "").split(" • ")[0].trim();
}

function formatSelectOption(id: string | undefined, label: string) {
  return id ? `${id}${label ? ` • ${label}` : ""}` : "";
}

function matchesEntityId(item: any, id: string) {
  const normalizedId = normalize(id);
  return [item?.id, item?.publicId, item?.matricule, item?.identifier].some((value) => normalize(value) === normalizedId);
}

function isValidPhotoReference(value: string) {
  return /^(https?:\/\/|file:\/\/|content:\/\/|data:image\/)/i.test(value);
}

function splitList(value?: string) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createInternalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generatePublicId(prefix: string, year: string, items: any[], size = 6) {
  const next = getNextSequence(items, new RegExp(`^${prefix}-${year}-(\\d+)$`, "i"));
  return `${prefix}-${year}-${String(next).padStart(size, "0")}`;
}

function generateTeacherPublicId(schoolCode: string, teachersData: any[]) {
  const normalizedSchool = String(schoolCode ?? "").trim().toUpperCase();
  const next = getNextSequence(
    teachersData,
    new RegExp(`^(?:${escapeRegExp(normalizedSchool)}-)?ENS-(\\d+)$`, "i")
  );
  const identifier = `ENS-${String(next).padStart(4, "0")}`;
  return `${normalizedSchool}-${identifier}`;
}

function generateLearnerPublicId(
  schoolCode: string,
  studentsData: any[],
  profile: "ELE" | "ETU" = "ELE"
) {
  const next = getNextSequence(
    studentsData,
    new RegExp(`^(?:${escapeRegExp(schoolCode)}-)?${profile}-(\\d+)$`, "i")
  );
  return `${profile}-${String(next).padStart(4, "0")}`;
}

function generateSchoolCode(country: string, year: string, schoolsData: any[]) {
  const countryCode = getCountryCode(country);
  const next = getNextSequence(
    schoolsData,
    new RegExp(`^${countryCode}-${year}-(\\d+)$`, "i"),
    "code"
  );
  return `${countryCode}-${year}-${String(next).padStart(4, "0")}`;
}

function getNextSequence(items: any[], pattern: RegExp, field = "publicId") {
  const highest = items.reduce((max, item) => {
    const value = String(item[field] ?? item.matricule ?? item.id ?? "");
    const match = value.match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return highest + 1;
}

function getCountryCode(country: string) {
  const value = normalize(country);
  const codes: Record<string, string> = {
    france: "FR",
    fr: "FR",
    rdc: "CD",
    "république démocratique du congo": "CD",
    "republique democratique du congo": "CD",
    congo: "CG",
    cg: "CG",
    cameroun: "CM",
    cm: "CM",
    sénégal: "SN",
    senegal: "SN",
    sn: "SN",
  };

  return codes[value] ?? (value.slice(0, 2).toUpperCase() || "CD");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGlobalOrCountryRole(role?: string) {
  return isSuperAdminRole(role) || role === "Admin Pays";
}

function shouldHideField(entity: AdminEntity, form: Record<string, string>, field: Field) {
  if (entity === "assignments") {
    const assignmentType = form.assignmentType || teacherCourseAssignmentType;
    if (assignmentType === studentClassAssignmentType) {
      return field.key === "teacherId" || field.key === "course";
    }

    return field.key === "studentId";
  }

  if (entity === "users") {
    if (field.key === "identifier") return true;
    if (form.role === "Admin Pays" && field.key === "schoolCode") return true;
  }

  return false;
}

function isAdminCreatedUser(item: any) {
  const creator = normalize(item.createdBy);
  return Boolean(creator) && !["systeme", "système", "postgresql", "seed", "migration"].includes(creator);
}

function canShowUserForSession(item: any, session: any) {
  if (isPlatformUserRole(item.role)) {
    return false;
  }

  const sessionSchoolCode = normalize(
    session?.user?.schoolCode && session.user.schoolCode !== "*"
      ? session.user.schoolCode
      : session?.school?.code
  );

  if (session?.role === "school_admin") {
    return normalize(item.schoolCode) === sessionSchoolCode;
  }

  return isAdminCreatedUser(item) || Boolean(item.schoolCode);
}

function isPlatformUserRole(role?: string) {
  return isSuperAdminRole(role) || role === "Admin Pays";
}

function getManageableSchoolUserRoles() {
  return Object.keys(rolePermissions)
    .filter((role) => !isPlatformUserRole(role))
    .filter((role) => !["Parent", "Élève / Étudiant"].includes(role));
}

function getMobilePilotageRoles(usersData: any[]) {
  const roles = new Set(["Secrétaire", "Préfet des études", "Enseignant", "Parent", "Élève / Étudiant"]);
  usersData.forEach((user) => {
    if (user?.role && !isPlatformUserRole(user.role) && user.role !== "Admin School") {
      roles.add(user.role);
    }
  });

  return [...roles].sort((left, right) => left.localeCompare(right, "fr"));
}

function getDelegablePermissionsForFeature(session: any, feature: string) {
  if (!feature) return [];
  return rolePilotageActions
    .filter((action) => hasSecurityPermission(session, feature, action.key))
    .map((action) => `${feature}:${action.key}`);
}

function isActiveUserAccount(item: any) {
  const status = normalize(item?.status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !["suspendu", "desactive", "disabled", "inactive", "inactif"].includes(status);
}

function getUserInitials(item: any) {
  const firstName = String(item?.firstName ?? "").trim();
  const lastName = String(item?.lastName ?? "").trim();
  const fallback = String(item?.identifier ?? item?.role ?? "U").trim();
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.trim().toUpperCase() || fallback.slice(0, 2).toUpperCase();
}

function getRoleDefaults(role?: string, schoolCode = "") {
  if (isSuperAdminRole(role)) {
    return { scopeLevel: "Global", schoolCode: "*", accessChannel: "Application" };
  }

  if (role === "Admin Pays") {
    return { scopeLevel: "Pays", schoolCode: "*", accessChannel: "Application" };
  }

  return { scopeLevel: "Établissement", schoolCode, accessChannel: "Application" };
}

function generateTemporaryPassword() {
  return `SF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateUserIdentifier(usersData: any[], role?: string) {
  const prefix = getUserIdentifierPrefix(role);
  const nextNumber = getNextSequence(usersData, new RegExp(`^${prefix}-(\\d+)$`, "i"), "identifier");
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
}

function getUserIdentifierPrefix(role?: string) {
  if (role === "Enseignant") return "ENS";
  if (role === "Élève / Étudiant" || role === "Élève" || role === "Étudiant") return "ELE";
  if (role === "Parent") return "PAR";
  if (role === "Admin School") return "ADM";
  if (role === "Préfet des études") return "PRF";
  if (role === "Secrétaire") return "SEC";
  return "USR";
}

function getDefaultSchoolCode(schoolsData: any[], session?: any) {
  const sessionSchool = session?.user?.schoolCode && session.user.schoolCode !== "*"
    ? session.user.schoolCode
    : session?.school?.code;
  return sessionSchool || schoolsData[0]?.code || "CD-2026-0001";
}

function schoolCodeFromContext(context?: any) {
  return context?.session
    ? getDefaultSchoolCode(context?.schoolsData ?? [], context.session)
    : context?.schoolsData?.[0]?.code ?? "CD-2026-0001";
}

function formatSelectOptionLabel(key: string, option: string): string {
  if (key === "accessChannel" && option === "BackOffice") return "Plateforme";
  return option;
}

function getSelectOptions(
  key: string | undefined,
  entity: AdminEntity,
  studentsData: any[],
  teachersData: any[],
  classesData: any[],
  coursesData: any[],
  paymentStatusesData: any[],
  schoolsData: any[],
  usersData: any[],
  countriesData: any[],
  form: Record<string, string>,
  academicConfigData?: { levels?: string[]; tracks?: string[]; classNames?: string[]; subjects?: string[] },
  editingId?: string
) {
  if (key === "level") {
    return academicConfigData?.levels?.length ? academicConfigData.levels : DEFAULT_LEVELS;
  }

  if (key === "track") {
    return academicConfigData?.tracks?.length ? academicConfigData.tracks : DEFAULT_TRACKS;
  }

  if (key === "mainSubject" || (key === "name" && entity === "courses") || (key === "course" && entity === "assignments")) {
    const configured = academicConfigData?.subjects?.length ? academicConfigData.subjects : DEFAULT_SUBJECTS;
    if (entity === "assignments" && key === "course") {
      const selectedClass = normalize(form.className);
      const fromCourses = coursesData
        .filter((course) => !selectedClass || normalize(course.className) === selectedClass)
        .map((course) => course.name)
        .filter(Boolean);
      return [...new Set([...configured, ...fromCourses])].sort((a, b) => a.localeCompare(b, "fr"));
    }
    return configured;
  }

  if (key === "gender") {
    return ["Masculin", "Féminin"];
  }

  if (key === "assignmentType") {
    return [teacherCourseAssignmentType, studentClassAssignmentType];
  }

  if (key === "teacherId") {
    return teachersData
      .map((teacher) => formatSelectOption(teacher.publicId ?? teacher.id, [teacher.name, teacher.mainSubject].filter(Boolean).join(" • ")))
      .filter(Boolean);
  }

  if (key === "parentPhone") {
    return [...new Set(studentsData.map((student) => student.parentPhone).filter(Boolean))];
  }

  if (key === "studentId") {
    if (entity === "assignments") {
      return studentsData
        .map((student) => formatSelectOption(student.id, [student.publicId ?? student.matricule, student.name, student.className].filter(Boolean).join(" • ")))
        .filter(Boolean);
    }

    return studentsData
      .filter((student) => !form.parentPhone || student.parentPhone === form.parentPhone)
      .map((student) => student.id)
      .filter(Boolean);
  }

  if (key === "theme") {
    return messageThemes;
  }

  if (key === "priority") {
    return ["Faible", "Moyenne", "Haute", "Critique"];
  }

  if (key === "method") {
    return ["Mobile Money", "Carte bancaire", "Espèces", "Virement bancaire"];
  }

  if (key === "type") {
    return ["École primaire", "Collège", "Lycée", "Université", "Institut"];
  }

  if (key === "role") {
    return getManageableSchoolUserRoles();
  }

  if (key === "schoolCode") {
    if (entity === "users") {
      return [form.schoolCode].filter(Boolean);
    }

    return entity === "subscriptions"
      ? schoolsData.map((schoolItem) => schoolItem.code).filter(Boolean)
      : schoolsData.map((schoolItem) => schoolItem.code).filter(Boolean);
  }

  if (key === "administratorId") {
    return usersData
      .filter((user) => user.role === "Admin Pays")
      .map((user) => user.publicId ?? user.identifier ?? user.id)
      .filter(Boolean);
  }

  if (key === "scopeLevel") {
    return ["Établissement"];
  }

  if (key === "accessChannel") {
    return ["BackOffice", "Application"];
  }

  if (key === "currency") {
    return ["CDF", "XOF", "XAF", "EUR", "USD"];
  }

  if (key === "timezone") {
    return ["Africa/Kinshasa", "Africa/Abidjan", "Africa/Dakar", "Africa/Douala", "Europe/Paris"];
  }

  if (key === "language") {
    return ["Français", "Anglais"];
  }

  if (key === "dateFormat") {
    return ["JJ-MM-AAAA", "AAAA-MM-JJ"];
  }

  if (key === "subscriptionPlan" || key === "plan") {
    return ["Essentiel", "Standard", "Premium"];
  }

  if (key === "paymentStatus") {
    return ["À jour", "En retard", "En attente"];
  }

  if (key === "name" && entity === "classes") {
    const configured = academicConfigData?.classNames?.length ? academicConfigData.classNames : DEFAULT_CLASS_NAMES;
    const taken = new Set(
      classesData
        .filter((schoolClass) => String(schoolClass.id ?? "") !== String(editingId ?? ""))
        .map((schoolClass) => normalize(schoolClass.name))
        .filter(Boolean)
    );
    const current = normalize(form.name);
    const options: string[] = [];
    const seen = new Set<string>();
    for (const name of configured) {
      const normalizedName = normalize(name);
      if (!normalizedName || seen.has(normalizedName)) continue;
      if (taken.has(normalizedName) && normalizedName !== current) continue;
      seen.add(normalizedName);
      options.push(name);
    }
    if (current && !seen.has(current) && form.name.trim()) {
      options.push(form.name.trim());
    }
    return options.sort((a, b) => a.localeCompare(b, "fr"));
  }

  if (key === "className") {
    const configured = academicConfigData?.classNames?.length ? academicConfigData.classNames : DEFAULT_CLASS_NAMES;
    const fromClasses = classesData.map((schoolClass) => schoolClass.name).filter(Boolean);
    return [...new Set([...configured, ...fromClasses])].sort((a, b) => a.localeCompare(b, "fr"));
  }

  if (key === "status") {
    if (entity === "users") {
      return ["Actif", "Suspendu", "Désactivé"];
    }

    if (entity === "schools") {
      return ["Actif", "Suspendu"];
    }

    if (entity === "countries") {
      return ["Actif", "Suspendu"];
    }

    if (entity === "subscriptions") {
      return ["Actif", "Suspendu", "Expiré"];
    }

    if (entity === "messages") {
      return ["Envoyé", "Distribué", "Lu", "Archivé", "Nouveau", "En cours", "Traité"];
    }

    const configuredStatuses = paymentStatusesData.map((status) => status.value).filter(Boolean);
    return configuredStatuses.length ? configuredStatuses : ["PAYE", "EN_ATTENTE", "IMPAYE"];
  }

  return [];
}

function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function parseDisplayDate(value?: string) {
  if (!value) return null;
  const [day, month, year] = value.split("-").map(Number);

  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

const monthNames = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function getInitialCalendarDate(field: Field, value?: string) {
  const parsed = parseDisplayDate(value);
  if (parsed) return parsed;

  const today = new Date();
  if (field.key === "birthDate") {
    return new Date(today.getFullYear() - 10, today.getMonth(), 1);
  }

  return today;
}

function buildYearOptions(field: Field | null, selectedDate: Date) {
  const currentYear = new Date().getFullYear();
  if (field?.key === "birthDate") {
    const startYear = currentYear - 80;
    return Array.from({ length: currentYear - startYear + 1 }, (_, index) => currentYear - index);
  }

  const selectedYear = selectedDate.getFullYear();
  const startYear = selectedYear - 5;
  return Array.from({ length: 11 }, (_, index) => startYear + index);
}

function getCalendarStepTitle(step: "year" | "month" | "day", date: Date) {
  if (step === "year") return "Choisir l'année";
  if (step === "month") return String(date.getFullYear());
  return formatMonth(date);
}

function getCalendarStepSubtitle(step: "year" | "month" | "day") {
  if (step === "year") return "Les années récentes sont affichées en premier";
  if (step === "month") return "Choisissez le mois";
  return "Choisissez le jour";
}

function setCalendarYear(date: Date, year: number) {
  return new Date(year, date.getMonth(), 1);
}

function setCalendarMonthIndex(date: Date, monthIndex: number) {
  return new Date(date.getFullYear(), monthIndex, 1);
}

function isSameDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function formatMonth(date: Date) {
  return date.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function buildCalendarDays(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: Array<Date | null> = Array(startOffset).fill(null);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(date.getFullYear(), date.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  addButton: {
    minWidth: 104,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 12,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 5,
  },
  filtersCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchBox: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: "#0F172A",
    fontWeight: "800",
  },
  filterRow: {
    gap: 8,
    paddingVertical: 4,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  filterPillActive: {
    backgroundColor: "#0F172A",
  },
  filterText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "900",
  },
  filterTextActive: {
    color: "#FFFFFF",
  },
  permissionPilotageCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  permissionPilotageHead: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  permissionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  permissionTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  permissionTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  permissionSubtitle: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  selectedFeatureCard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    gap: 12,
  },
  permissionFeatureName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
  },
  permissionActions: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
  permissionCrudColumn: {
    gap: 10,
  },
  permissionCrudRow: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  permissionCrudText: {
    flex: 1,
    minWidth: 0,
  },
  permissionCrudLabel: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "900",
  },
  permissionCrudStatus: {
    marginTop: 3,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
  toggleButton: {
    minWidth: 84,
    minHeight: 40,
    borderRadius: 999,
    padding: 4,
    paddingRight: 10,
    backgroundColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleButtonActive: {
    backgroundColor: "#DCFCE7",
  },
  toggleKnob: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#94A3B8",
  },
  toggleKnobActive: {
    backgroundColor: "#16A34A",
  },
  toggleButtonText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "900",
  },
  toggleButtonTextActive: {
    color: "#166534",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  userList: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    marginBottom: 12,
  },
  userListRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: {
    color: "#2563EB",
    fontSize: 13,
    fontWeight: "900",
  },
  userListContent: {
    flex: 1,
    minWidth: 0,
  },
  userListTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  userListName: {
    flex: 1,
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
  },
  userListRole: {
    marginTop: 3,
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "900",
  },
  userListMeta: {
    marginTop: 3,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  userTempPassword: {
    marginTop: 4,
    color: "#B45309",
    fontSize: 12,
    fontWeight: "800",
  },
  userStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  userStatusActive: {
    backgroundColor: "#DCFCE7",
  },
  userStatusInactive: {
    backgroundColor: "#FEE2E2",
  },
  userStatusText: {
    fontSize: 10,
    fontWeight: "900",
  },
  userStatusTextActive: {
    color: "#166534",
  },
  userStatusTextInactive: {
    color: "#991B1B",
  },
  userListActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  listActionButton: {
    minHeight: 34,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: "#EFF6FF",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  listActionButtonWarning: {
    minHeight: 34,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: "#FEF3C7",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  listActionButtonDanger: {
    minHeight: 34,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: "#FEF2F2",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  listActionText: {
    color: "#2563EB",
    fontSize: 11,
    fontWeight: "900",
  },
  listActionTextWarning: {
    color: "#B45309",
    fontSize: 11,
    fontWeight: "900",
  },
  listActionTextDanger: {
    color: "#DC2626",
    fontSize: 11,
    fontWeight: "900",
  },
  classCardsBlock: {
    marginBottom: 14,
  },
  blockLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
  },
  classCardsList: {
    gap: 10,
    paddingRight: 4,
  },
  classCard: {
    minWidth: 132,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  classCardSelected: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  classCardTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
  },
  classCardTitleSelected: {
    color: "#FFFFFF",
  },
  classCardMeta: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  classCardMetaSelected: {
    color: "#CBD5E1",
  },
  courseHeader: {
    marginTop: 14,
    backgroundColor: "#EFF6FF",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  courseHeaderTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
  },
  courseHeaderMeta: {
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "900",
  },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  emptyText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 8,
    textAlign: "center",
  },
  cardContent: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  cardMeta: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 4 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  iconButtonWarning: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  iconButtonDanger: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    maxHeight: "88%",
  },
  modalTitle: { color: "#0F172A", fontSize: 22, fontWeight: "900", marginBottom: 16 },
  formScroll: {
    maxHeight: 480,
  },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { color: "#334155", fontSize: 12, fontWeight: "900", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0F172A",
    fontWeight: "700",
  },
  selectInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectInputLocked: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
  },
  selectText: {
    color: "#0F172A",
    fontWeight: "800",
  },
  selectPlaceholder: {
    color: "#94A3B8",
  },
  photoField: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 12,
  },
  photoPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  photoPreview: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: "#E2E8F0",
  },
  photoMeta: {
    flex: 1,
    marginLeft: 12,
  },
  photoTitle: {
    color: "#0F172A",
    fontWeight: "900",
  },
  photoSubtitle: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  photoHelp: {
    color: "#94A3B8",
    fontWeight: "800",
    marginBottom: 10,
  },
  photoButton: {
    backgroundColor: "#EFF6FF",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  photoButtonText: {
    color: "#2563EB",
    fontWeight: "900",
    marginLeft: 8,
  },
  photoRemoveButton: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelButton: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#2563EB",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  cancelText: { color: "#334155", fontWeight: "900" },
  saveText: { color: "#FFFFFF", fontWeight: "900" },
  selectorBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 24,
  },
  selectorCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    maxHeight: "72%",
  },
  selectorTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "900",
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  calendarTitleBox: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 10,
  },
  calendarSubtitle: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  calendarNav: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarStepScroll: {
    maxHeight: 360,
    marginBottom: 12,
  },
  yearGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingBottom: 4,
  },
  yearChip: {
    width: "31%",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    marginBottom: 10,
  },
  yearChipActive: {
    backgroundColor: "#2563EB",
  },
  yearChipText: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "900",
  },
  yearChipTextActive: {
    color: "#FFFFFF",
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  monthChip: {
    width: "31%",
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    marginBottom: 10,
  },
  monthChipActive: {
    backgroundColor: "#DBEAFE",
  },
  monthChipText: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "900",
  },
  monthChipTextActive: {
    color: "#1D4ED8",
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekDay: {
    width: `${100 / 7}%`,
    textAlign: "center",
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCellEmpty: {
    opacity: 0,
  },
  dayText: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    lineHeight: 34,
  },
  dayTextActive: {
    backgroundColor: "#2563EB",
    color: "#FFFFFF",
  },
  selectorList: {
    marginBottom: 12,
  },
  selectorOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorOptionText: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  selectorCancel: {
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
});
