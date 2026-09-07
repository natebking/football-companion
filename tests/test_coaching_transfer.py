import json
from pathlib import Path
import sys
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'engine'))
import coaching_transfer as transfer
import coaching_pilot as pilot
from test_coaching_pilot import fixture


class TransferTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=json.loads(transfer.CATALOG.read_text())

    def test_transfers_require_a_prior_other_team_not_a_head_coach_change(self):
        starts=transfer.transfer_starts(self.catalog)
        self.assertNotIn('kellen_moore_DAL',starts)
        self.assertEqual(starts['kellen_moore_LAC'],2023)
        self.assertEqual(starts['kellen_moore_PHI'],2024)
        self.assertEqual(starts['kellen_moore_NO'],2025)
        self.assertEqual(starts['arthur_smith_ATL'],2021)
        self.assertEqual(starts['arthur_smith_PIT'],2024)
        self.assertEqual(starts['sean_payton_DEN'],2023)
        self.assertNotIn('davis_webb_DEN',starts)

    def test_changed_test_results_cannot_change_fit_or_predictions(self):
        frame=fixture()
        _,p,folds=transfer.evaluate(frame,self.catalog,holdouts=[2023])
        mask=frame.season.eq(2023)
        changed=frame.copy();changed.loc[mask,'is_pass']=~frame.loc[mask,'is_pass'];changed.loc[mask,'is_rush']=~frame.loc[mask,'is_rush']
        _,other,other_folds=transfer.evaluate(changed,self.catalog,holdouts=[2023])
        self.assertEqual(folds,other_folds)
        np.testing.assert_array_equal(p[transfer.MODELS],other[transfer.MODELS])
        self.assertTrue(p.transfer.all())
        self.assertFalse(p.firstTransferSeason.isna().any())
        self.assertTrue(p.firstTransferSeason.all())
        self.assertEqual(set(p.tenure_id),{'sean_payton_DEN'})
        self.assertEqual(set(p.offense),{'DEN'})

    def test_all_assignment_sources_exist_and_uncatalogued_roles_stay_unknown(self):
        for a in self.catalog['assignments']:
            self.assertTrue(a['sourceIds'])
            for source in a['sourceIds']:
                self.assertIn(source,self.catalog['sources'])
        import pandas as pd
        frame=pd.DataFrame({'offense':['DAL','DAL','LAC','PHI','NO','PIT','PIT','DEN'],
            'season':[2019,2023,2023,2024,2025,2025,2026,2026], 'game_id':list('abcdefgh')})
        caller,_=pilot.caller_labels(frame,self.catalog)
        self.assertEqual(caller.tolist(),['kellen_moore',None,'kellen_moore','kellen_moore','kellen_moore','arthur_smith',None,'davis_webb'])


if __name__=='__main__':
    unittest.main()
