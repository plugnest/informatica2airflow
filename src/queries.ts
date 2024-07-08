import { DATABASE } from "./constants";

export const SUB_WF = `SELECT
                S.SUBJ_NAME FOLDER,
                M.MAPPING_NAME MAPPING
                FROM ${DATABASE}.OPB_MAPPING M, ${DATABASE}.OPB_SUBJECT S
                WHERE M.SUBJECT_ID = S.SUBJ_ID 
                AND is_visible = 1`;