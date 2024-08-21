import { DATABASE } from "./constants";

export const WORKFLOW_SESSION_INSTANCES = `
WITH LatestTaskVersion AS (
  SELECT 
    INSTANCE_ID, 
    WORKFLOW_ID, 
    MAX(VERSION_NUMBER) AS LATEST_VERSION 
  FROM 
    ${DATABASE}.OPB_TASK_INST 
  GROUP BY 
    INSTANCE_ID, 
    WORKFLOW_ID
), 
LatestExprVersion AS (
  SELECT 
    WORKFLOW_ID, 
    CONDITION_ID, 
    MAX(VERSION_NUMBER) AS LATEST_VERSION 
  FROM 
    ${DATABASE}.OPB_WFLOW_EXPR 
  GROUP BY 
    WORKFLOW_ID, 
    CONDITION_ID
), 
MaxMappingVersion AS (
  SELECT 
    MAPPING_ID, 
    max(VERSION_NUMBER) LATEST_VERSION 
  FROM 
    ${DATABASE}.opb_mapping om 
  GROUP BY 
    MAPPING_ID
), 
LatestSessionVersion AS (
  SELECT 
    SESSION_ID, 
    MAX(VERSION_NUMBER) AS LATEST_VERSION 
  FROM 
    ${DATABASE}.OPB_SESSION 
  GROUP BY 
    SESSION_ID
) 
SELECT 
  owd.FROM_INST_ID, 
  owd.TO_INST_ID, 
  owd.CONDITION_ID, 
  oexpr.CONDITION, 
  oti_from.TASK_ID AS FROM_TASK_ID, 
  oti_from.INSTANCE_NAME AS FROM_INST_NAME, 
  oti_from.TASK_TYPE AS FROM_INST_TASK_TYPE, 
  (
    SELECT 
      OBJECT_TYPE_NAME 
    FROM 
      ${DATABASE}.OPB_OBJECT_TYPE oot 
    WHERE 
      OBJECT_TYPE_ID = OTI_FROM.TASK_TYPE
  ) AS FROM_INST_TASK_TYPE_NAME, 
  oti_to.TASK_ID AS TO_TASK_ID, 
  oti_to.INSTANCE_NAME AS TO_INST_NAME, 
  oti_to.TASK_TYPE AS TO_INST_TASK_TYPE, 
  (
    SELECT 
      OBJECT_TYPE_NAME 
    FROM 
      ${DATABASE}.OPB_OBJECT_TYPE oot 
    WHERE 
      OBJECT_TYPE_ID = OTI_TO.TASK_TYPE
  ) AS TO_INST_TASK_TYPE_NAME, 
  (
    SELECT 
      MAPPING_NAME 
    FROM 
      ${DATABASE}.OPB_SESSION os 
      JOIN ${DATABASE}.OPB_MAPPING om ON os.MAPPING_ID = om.MAPPING_ID 
      AND om.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          MaxMappingVersion 
        WHERE 
          MAPPING_ID = os.MAPPING_ID
      ) 
    WHERE 
      os.SESSION_ID = OTI_FROM.TASK_ID 
      AND os.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          LatestSessionVersion 
        WHERE 
          SESSION_ID = OTI_FROM.TASK_ID
      )
  ) AS FROM_INST_MAPPING_NAME, 
    (
    SELECT 
      os.MAPPING_ID
    FROM 
      ${DATABASE}.OPB_SESSION os 
    WHERE 
      os.SESSION_ID = OTI_FROM.TASK_ID 
      AND os.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          LatestSessionVersion 
        WHERE 
          SESSION_ID = OTI_FROM.TASK_ID
      )
  ) AS FROM_INST_MAPPING_ID, 
  (
    SELECT 
      os.MAPPING_ID
    FROM 
      ${DATABASE}.OPB_SESSION os     
    WHERE 
      SESSION_ID = OTI_TO.TASK_ID 
      AND os.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          LatestSessionVersion 
        WHERE 
          SESSION_ID = OTI_TO.TASK_ID
      )
  ) AS TO_INST_MAPPING_ID,
  (
    SELECT 
      MAPPING_NAME
    FROM 
      ${DATABASE}.OPB_SESSION os
      JOIN ${DATABASE}.OPB_MAPPING om ON os.MAPPING_ID = om.MAPPING_ID 
      AND om.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          MaxMappingVersion 
        WHERE 
          MAPPING_ID = os.MAPPING_ID
      )      
    WHERE 
      SESSION_ID = OTI_TO.TASK_ID 
      AND os.VERSION_NUMBER = (
        SELECT 
          LATEST_VERSION 
        FROM 
          LatestSessionVersion 
        WHERE 
          SESSION_ID = OTI_TO.TASK_ID
      )
  ) AS TO_INST_MAPPING_NAME
FROM
	${DATABASE}.OPB_WFLOW_DEP owd
JOIN ${DATABASE}.OPB_TASK_INST oti_from
    ON
	oti_from.INSTANCE_ID = owd.FROM_INST_ID
	AND oti_from.WORKFLOW_ID = owd.WORKFLOW_ID
	AND oti_from.VERSION_NUMBER = (
	SELECT
		LATEST_VERSION
	FROM
		LatestTaskVersion
	WHERE
		INSTANCE_ID = owd.FROM_INST_ID
    )
	-- AND oti_from.IS_ENABLED = 1
	-- AND oti_from.IS_VALID = 1
JOIN ${DATABASE}.OPB_TASK_INST oti_to
    ON
	oti_to.INSTANCE_ID = owd.TO_INST_ID
	AND oti_to.WORKFLOW_ID = owd.WORKFLOW_ID
	AND oti_to.VERSION_NUMBER = (
	SELECT
		LATEST_VERSION
	FROM
		LatestTaskVersion
	WHERE
		INSTANCE_ID = owd.TO_INST_ID
    )
	-- AND oti_to.IS_ENABLED = 1
	-- AND oti_to.IS_VALID = 1
JOIN ${DATABASE}.OPB_WFLOW_EXPR oexpr
    ON
	oexpr.WORKFLOW_ID = owd.WORKFLOW_ID
	AND oexpr.CONDITION_ID = owd.CONDITION_ID
	AND oexpr.VERSION_NUMBER = (
	SELECT
		LATEST_VERSION
	FROM
		LatestExprVersion
	WHERE
		WORKFLOW_ID = owd.WORKFLOW_ID
		AND CONDITION_ID = owd.CONDITION_ID
    )
WHERE
	owd.WORKFLOW_ID = (
	SELECT
		DISTINCT WORKFLOW_ID
	FROM
		${DATABASE}.REP_TASK_INST_RUN rtir
	WHERE
		WORKFLOW_NAME = :WORKFLOWNAME
		AND SUBJECT_AREA = :SUBJECTAREANAME
)
	AND owd.VERSION_NUMBER = (
	SELECT
		MAX(VERSION_NUMBER)
	FROM
		${DATABASE}.OPB_WFLOW_DEP owd2
	WHERE
		owd.WORKFLOW_ID = owd2.WORKFLOW_ID
    )`;

export const SUB_WF = `SELECT 
	OPB_SUBJECT.SUBJ_NAME SUBJECT_AREA,
	OPB_WFLOW_RUN.WORKFLOW_NAME
FROM 
    ${DATABASE}.OPB_TASK_INST_RUN OPB_TASK_INST_RUN, ${DATABASE}.OPB_WFLOW_RUN OPB_WFLOW_RUN, ${DATABASE}.OPB_SUBJECT OPB_SUBJECT
WHERE 
	OPB_SUBJECT.SUBJ_ID = OPB_TASK_INST_RUN.SUBJECT_ID
	AND OPB_WFLOW_RUN.WORKFLOW_ID = OPB_TASK_INST_RUN.WORKFLOW_ID 
GROUP BY OPB_SUBJECT.SUBJ_NAME, OPB_WFLOW_RUN.WORKFLOW_NAME
ORDER BY OPB_SUBJECT.SUBJ_NAME`;

export const INSTANCES = `SELECT    
    OPB_OBJECT_TYPE.OBJECT_TYPE_NAME AS TASK_TYPE_NAME,
    OPB_TASK_INST_RUN.TASK_NAME
FROM 
    ${DATABASE}.OPB_TASK_INST_RUN
JOIN 
    ${DATABASE}.OPB_OBJECT_TYPE ON ${DATABASE}.OPB_TASK_INST_RUN.TASK_TYPE = ${DATABASE}.OPB_OBJECT_TYPE.OBJECT_TYPE_ID
JOIN 
    ${DATABASE}.OPB_WFLOW_RUN ON ${DATABASE}.OPB_TASK_INST_RUN.WORKFLOW_ID = ${DATABASE}.OPB_WFLOW_RUN.WORKFLOW_ID 
                                     AND ${DATABASE}.OPB_TASK_INST_RUN.WORKFLOW_RUN_ID = ${DATABASE}.OPB_WFLOW_RUN.WORKFLOW_RUN_ID 
JOIN 
    ${DATABASE}.OPB_SUBJECT ON ${DATABASE}.OPB_TASK_INST_RUN.SUBJECT_ID = ${DATABASE}.OPB_SUBJECT.SUBJ_ID
WHERE 
    ${DATABASE}.OPB_WFLOW_RUN.WORKFLOW_NAME = :workflowName
    AND ${DATABASE}.OPB_SUBJECT.SUBJ_NAME = :subjectAreaName
GROUP BY 
    ${DATABASE}.OPB_SUBJECT.SUBJ_NAME,
    ${DATABASE}.OPB_WFLOW_RUN.WORKFLOW_NAME,
    ${DATABASE}.OPB_OBJECT_TYPE.OBJECT_TYPE_NAME,
    ${DATABASE}.OPB_TASK_INST_RUN.TASK_NAME
ORDER BY OPB_SUBJECT.SUBJ_NAME
`;

export const INSTANCES_BAK = `
SELECT 
       rtir.TASK_TYPE_NAME, rtir.INSTANCE_NAME,
       MAX(START_TIME) START_TIME, 
       MAX(END_TIME) AS END_TIME
FROM ${DATABASE}.REP_TASK_INST_RUN rtir
JOIN ${DATABASE}.REP_TASK_INST rti ON rti.TASK_ID = rtir.TASK_ID AND rti.IS_ENABLED = 1
WHERE WORKFLOW_NAME = :workflowName
AND SUBJECT_AREA = :subjectAreaName
GROUP BY rtir.INSTANCE_ID, rtir.WORKFLOW_NAME, rtir.INSTANCE_NAME, rtir.TASK_TYPE_NAME, rtir.TASK_ID 
ORDER BY START_TIME ASC, END_TIME ASC, rtir.TASK_ID ASC
`;

export const COMMANDS = `
SELECT PM_VALUE, VAL_NAME FROM ${DATABASE}.OPB_TASK_VAL_LIST f
WHERE TASK_ID = (
	SELECT MAX(TASK_ID) FROM ${DATABASE}.REP_TASK_INST rti WHERE rti.INSTANCE_NAME = :taskName
	AND rti.WORKFLOW_ID = (SELECT MAX(WORKFLOW_ID) FROM ${DATABASE}.REP_WFLOW_RUN rwr WHERE rwr.WORKFLOW_NAME = :workflowName))
AND SUBJECT_ID = (SELECT MAX(SUBJECT_ID) FROM ${DATABASE}.REP_WFLOW_RUN rwr WHERE rwr.SUBJECT_AREA = :subjectAreaName)
AND VERSION_NUMBER = (SELECT MAX(VERSION_NUMBER) FROM ${DATABASE}.OPB_TASK_VAL_LIST g WHERE TASK_ID = f.TASK_ID AND SUBJECT_ID = f.SUBJECT_ID )
ORDER BY EXEC_ORDER
`;

export const EVENT_WAIT_FILE = `
SELECT ATTR_VALUE
FROM (
	SELECT ATTR_VALUE, ROW_NUMBER() OVER (ORDER BY VERSION_NUMBER DESC) RNK
	FROM
		(SELECT SUBJECT_AREA, WORKFLOW_NAME, INSTANCE_ID, INSTANCE_NAME, TASK_ID, TASK_TYPE_NAME,
			ROW_NUMBER() OVER (ORDER BY END_TIME DESC) RNK
		FROM ${DATABASE}.REP_TASK_INST_RUN R
		WHERE SUBJECT_AREA = :subjectAreaName
		  AND WORKFLOW_NAME = :workflowName
		  AND INSTANCE_NAME = :taskName) R,
	  	${DATABASE}.OPB_TASK_ATTR O
	WHERE R.TASK_ID = O.TASK_ID
		AND RNK = 1
		AND ATTR_ID = 4)
WHERE RNK = 1
`;

export const SESSION_WIDGET = `
 WITH MaxVersion AS (
	SELECT SESSION_ID, MAPPING_ID, MAX(VERSION_NUMBER) VERSION_NUMBER 
	FROM ${DATABASE}.opb_Swidget_inst
	GROUP BY MAPPING_ID, SESSION_ID 
)
SELECT SESSION_ID, SESS_WIDG_INST_ID,WIDGET_ID,WIDGET_TYPE,INSTANCE_ID,INSTANCE_NAME, (SELECT OBJECT_TYPE_NAME FROM ${DATABASE}.OPB_OBJECT_TYPE oot WHERE oot.OBJECT_TYPE_ID = osi.WIDGET_TYPE) AS WIDGET_TYPE_NAME 
FROM ${DATABASE}.OPB_SWIDGET_INST osi 
WHERE SESSION_ID = :SESSION_ID AND VERSION_NUMBER = (SELECT VERSION_NUMBER FROM MaxVersion mv WHERE mv.session_id = osi.SESSION_ID AND mv.mapping_id = OSI.MAPPING_ID)
`;

export const SESSION_CONNECTION = `
WITH MaxSessCnxRefVersion AS (
  SELECT SESSION_ID, SESS_WIDG_INST_ID, MAX(VERSION_NUMBER) AS LATEST_VERSION
  FROM ${DATABASE}.OPB_SESS_CNX_REFS
  GROUP BY SESSION_ID, SESS_WIDG_INST_ID 
),
SessionCnxRefs AS (
  SELECT 
      oscr.SESSION_ID, 
      oscr.SESS_WIDG_INST_ID, 
      oscr.REF_OBJECT_ID, 
      oscr.REF_OBJECT_TYPE, 
      oscr.REF_OBJECT_SUBTYP, 
      oc.OBJECT_NAME, 
      oc.USER_NAME
  FROM ${DATABASE}.OPB_SESS_CNX_REFS oscr 
  LEFT JOIN ${DATABASE}.OPB_CNX oc 
      ON oc.OBJECT_ID = oscr.REF_OBJECT_ID 
      AND oc.OBJECT_TYPE = oscr.REF_OBJECT_TYPE 
      AND oc.OBJECT_SUBTYPE = oscr.REF_OBJECT_SUBTYP 
  WHERE oscr.SESSION_ID = :SESSION_ID
  AND oscr.VERSION_NUMBER = (
      SELECT LATEST_VERSION 
      FROM MaxSessCnxRefVersion mv 
      WHERE mv.SESSION_ID = oscr.SESSION_ID 
      AND mv.SESS_WIDG_INST_ID = oscr.SESS_WIDG_INST_ID
  )
),
MaxCnxAttrVersion AS (
  SELECT 
      OBJECT_ID, 
      OBJECT_TYPE, 
      OBJECT_SUBTYPE, 
      ATTR_ID, 
      ATTR_VALUE, 
      MAX(VERSION_NUMBER) AS LATEST_VERSION
  FROM ${DATABASE}.OPB_CNX_ATTR
  GROUP BY OBJECT_ID, OBJECT_TYPE, OBJECT_SUBTYPE, ATTR_ID, ATTR_VALUE
),
CnxAttr AS (
  SELECT 
      oca.OBJECT_ID, 
      oca.OBJECT_TYPE, 
      oca.OBJECT_SUBTYPE, 
      oca.ATTR_ID, 
      oca.ATTR_VALUE
  FROM ${DATABASE}.OPB_CNX_ATTR oca 
  WHERE 
  oca.VERSION_NUMBER = (
      SELECT LATEST_VERSION 
      FROM MaxCnxAttrVersion mv 
      WHERE oca.OBJECT_ID = mv.OBJECT_ID 
      AND oca.OBJECT_TYPE = mv.OBJECT_TYPE 
      AND oca.OBJECT_SUBTYPE = mv.OBJECT_SUBTYPE 
      AND oca.ATTR_ID = mv.ATTR_ID 
      AND oca.ATTR_VALUE = mv.ATTR_VALUE
  )
  ORDER BY oca.ATTR_ID 
)
SELECT 
  sc.SESSION_ID, 
  sc.SESS_WIDG_INST_ID, 
  sc.REF_OBJECT_ID, 
  sc.REF_OBJECT_TYPE, 
  sc.REF_OBJECT_SUBTYP, 
  sc.OBJECT_NAME, 
  sc.USER_NAME,
  ca.ATTR_ID,
  ca.ATTR_VALUE
FROM SessionCnxRefs sc
LEFT JOIN CnxAttr ca 
  ON sc.REF_OBJECT_ID = ca.OBJECT_ID 
  AND sc.REF_OBJECT_TYPE = ca.OBJECT_TYPE 
  AND sc.REF_OBJECT_SUBTYP = ca.OBJECT_SUBTYPE
`;

export const SESSION_WRITERS_READERS = `
WITH SessionData AS (
    SELECT * 
    FROM ${DATABASE}.OPB_SESS_EXTNS 
    WHERE SESSION_ID = :SESSION_ID
),
MaxSessExtnsVersion AS (
    SELECT SESS_WIDG_INST_ID, MAX(VERSION_NUMBER) AS MAX_VERSION_NUMBER
    FROM SessionData
    GROUP BY SESS_WIDG_INST_ID
)
SELECT sd.SESSION_ID, sd.SESS_WIDG_INST_ID, sd.OBJECT_TYPE, sd.OBJECT_SUBTYPE, OMSE.OBJECT_NAME 
FROM SessionData sd
JOIN MaxSessExtnsVersion mv 
    ON sd.SESS_WIDG_INST_ID = mv.SESS_WIDG_INST_ID
    AND sd.VERSION_NUMBER = mv.MAX_VERSION_NUMBER
JOIN ${DATABASE}.OPB_MMD_SESS_EXTNS omse
	ON omse.OBJECT_TYPE = sd.object_type
	AND omse.OBJECT_SUBTYPE = sd.OBJECT_SUBTYPE
`;

export const SESSION_FILE_VALS = `
WITH LatestSessFileValsVersion AS(
	SELECT SESSION_ID, MAX(VERSION_NUMBER) LATEST_VERSION
	FROM ${DATABASE}.OPB_SESS_FILE_VALS
	GROUP BY SESSION_ID 
)
SELECT FILE_NAME, DIR_NAME FROM ${DATABASE}.OPB_SESS_FILE_VALS osfv WHERE SESSION_ID = :SESSION_ID AND SESS_WIDG_INST_ID = :WIDGET_ID AND VERSION_NUMBER = (SELECT LATEST_VERSION FROM LatestSessFileValsVersion WHERE SESSION_ID = OSFV.SESSION_ID)
`;

export const SESSION_WIDGET_ATTRIBUTES = `
WITH LatestSwidgetVersion AS(
	SELECT SESSION_ID, MAX(VERSION_NUMBER) LATEST_VERSION
	FROM ${DATABASE}.OPB_SWIDGET_ATTR
	GROUP BY SESSION_ID 
)
SELECT SESS_WIDG_INST_ID, ATTR_ID, ATTR_VALUE FROM ${DATABASE}.OPB_SWIDGET_ATTR osa WHERE SESSION_ID = :SESSION_ID AND VERSION_NUMBER = (SELECT LATEST_VERSION FROM LatestSwidgetVersion WHERE SESSION_ID = osa.SESSION_ID)
`; 

export const WIDGET_SOURCE_FILED = `
WITH MaxVersion AS (
	SELECT SRC_ID, max(VERSION_NUMBER) VERSION_NUMBER 
	FROM ${DATABASE}.OPB_SRC_FLD
	GROUP BY SRC_ID
)
SELECT SRC_NAME, LEN FROM ${DATABASE}.OPB_SRC_FLD osf WHERE SRC_ID = :SRC_ID
AND VERSION_NUMBER = (SELECT VERSION_NUMBER FROM MaxVersion mv WHERE mv.SRC_ID = osf.SRC_ID)
`;

export const WIDGET_TARGET_FILED = `
WITH MaxVersion AS (
	SELECT TARGET_ID, max(VERSION_NUMBER) VERSION_NUMBER 
	FROM OPB_TARG_FLD
	GROUP BY TARGET_ID
)
SELECT TARGET_NAME FROM OPB_TARG_FLD otf WHERE TARGET_ID = :TARGET_ID
AND VERSION_NUMBER = (SELECT VERSION_NUMBER FROM MaxVersion mv WHERE mv.TARGET_ID = otf.TARGET_ID)
`;

export const WIDGET_WIDGET_FILED = `
WITH MaxVersion AS (
	SELECT WIDGET_ID, max(VERSION_NUMBER) VERSION_NUMBER 
	FROM OPB_WIDGET_FIELD
	GROUP BY WIDGET_ID
)
SELECT FIELD_NAME, FIELD_ORDER, WGT_DATATYPE FROM OPB_WIDGET_FIELD owf WHERE WIDGET_ID = :WIDGET_ID
AND VERSION_NUMBER = (SELECT VERSION_NUMBER FROM MaxVersion mv WHERE mv.WIDGET_ID = owf.WIDGET_ID)
`;