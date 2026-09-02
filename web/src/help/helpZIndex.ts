/**
 * Politique d'empilement HELP-V1B.
 *
 * Toast            z-50  centre bas — les erreurs restent visibles
 * MobileNavDrawer  z-50  menu mobile Web
 * Modal/Confirm/Prompt z-40
 * HelpPanel        z-35  sous les modales métier et le toast
 * HelpTrigger      z-30  bas-droite, relevé au-dessus des sticky actions (bottom-24 / sm:bottom-20)
 *
 * Escape : le panneau HELP intercepte Escape seulement s'il a le focus
 * (focus trap). Une modale au-dessus (z-40) reçoit alors Escape en premier.
 * Toute navigation ferme HELP.
 */
export const HELP_TRIGGER_ZCLASS = "z-[30]";
export const HELP_PANEL_ZCLASS = "z-[35]";
